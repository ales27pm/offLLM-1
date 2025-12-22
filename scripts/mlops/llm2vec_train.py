#!/usr/bin/env python3
"""
llm2vec_train.py - Train an embedding head (and optionally LoRA) on top of a causal LM using
a simple self-supervised contrastive objective (InfoNCE) with two random-crop views.

This is NOT "magic llm2vec paper reproduction", but it is a real, working embedding training stage:
- Loads base model + LoRA adapter (from sft stage)
- Builds sentence embeddings via mean pooling of last hidden state + projection head
- Trains with symmetric InfoNCE loss across two augmented views of each example
- Saves:
  - adapter/  (updated LoRA adapter)
  - projection.pt (projection head weights)
  - llm2vec_config.json
  - tokenizer/
"""

import argparse
import json
import math
import os
import random
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, BitsAndBytesConfig

from peft import PeftModel


def _bnb_available() -> bool:
    try:
        import bitsandbytes  # noqa: F401
        return True
    except Exception:
        return False


def _cuda() -> bool:
    return torch.cuda.is_available()


def _cc() -> Tuple[int, int]:
    if not _cuda():
        return (0, 0)
    return torch.cuda.get_device_capability(0)


def _bf16_ok() -> bool:
    # RTX 2070 is Turing (7.5) => bf16 False
    if not _cuda():
        return False
    major, _minor = _cc()
    if major < 8:
        return False
    fn = getattr(torch.cuda, "is_bf16_supported", None)
    return bool(fn() if callable(fn) else False)


def _dtype() -> torch.dtype:
    return torch.bfloat16 if _bf16_ok() else torch.float16


def _default_train_file_from_lora(lora_dir: Path) -> Optional[Path]:
    # lora_dir = .../runs/001/models/sft_lora
    # run_dir  = .../runs/001
    try:
        run_dir = lora_dir.parents[1]
    except Exception:
        return None

    candidates = [
        run_dir / "datasets" / "sft_dataset.normalized.jsonl",
        run_dir / "datasets" / "sft_dataset.jsonl",
    ]
    for c in candidates:
        if c.exists():
            return c

    ds_dir = run_dir / "datasets"
    if ds_dir.exists():
        jsonls = sorted(ds_dir.glob("*.jsonl"))
        if jsonls:
            return jsonls[0]
    return None


class TextDataset(Dataset):
    def __init__(self, texts: List[str]):
        self.texts = [t for t in texts if isinstance(t, str) and t.strip()]

    def __len__(self) -> int:
        return len(self.texts)

    def __getitem__(self, idx: int) -> str:
        return self.texts[idx]


def _random_token_window(input_ids: torch.Tensor, max_len: int) -> torch.Tensor:
    # input_ids: (seq,)
    seq_len = int(input_ids.numel())
    if seq_len <= max_len:
        return input_ids
    start = random.randint(0, seq_len - max_len)
    return input_ids[start : start + max_len]


def _collate_two_views(tokenizer, max_len: int):
    def collate(batch_texts: List[str]) -> Dict[str, torch.Tensor]:
        # Tokenize a longer buffer then crop two windows => two views
        # Keep it simple (batch size is small in your pipeline).
        toks = tokenizer(
            batch_texts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=max_len * 2,
        )
        input_ids = toks["input_ids"]
        attn = toks["attention_mask"]

        v1_ids, v2_ids = [], []
        v1_attn, v2_attn = [], []

        for i in range(input_ids.size(0)):
            ids = input_ids[i][attn[i].bool()]
            ids1 = _random_token_window(ids, max_len)
            ids2 = _random_token_window(ids, max_len)

            # pad back to max_len
            def pad(x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
                x = x[:max_len]
                pad_len = max_len - int(x.numel())
                if pad_len > 0:
                    x = torch.cat([x, torch.full((pad_len,), tokenizer.pad_token_id, dtype=x.dtype)])
                a = (x != tokenizer.pad_token_id).long()
                return x, a

            p1, a1 = pad(ids1)
            p2, a2 = pad(ids2)
            v1_ids.append(p1); v1_attn.append(a1)
            v2_ids.append(p2); v2_attn.append(a2)

        return {
            "v1_input_ids": torch.stack(v1_ids, dim=0),
            "v1_attention_mask": torch.stack(v1_attn, dim=0),
            "v2_input_ids": torch.stack(v2_ids, dim=0),
            "v2_attention_mask": torch.stack(v2_attn, dim=0),
        }

    return collate


class Embedder(nn.Module):
    def __init__(self, base_model: nn.Module, hidden_size: int, proj_dim: int):
        super().__init__()
        self.base_model = base_model
        self.proj = nn.Linear(hidden_size, proj_dim, bias=False)

    @staticmethod
    def mean_pool(last_hidden: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        # last_hidden: (B, T, H), attention_mask: (B, T)
        mask = attention_mask.unsqueeze(-1).to(last_hidden.dtype)  # (B,T,1)
        summed = (last_hidden * mask).sum(dim=1)
        denom = mask.sum(dim=1).clamp(min=1e-6)
        return summed / denom

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        out = self.base_model(
            input_ids=input_ids,
            attention_mask=attention_mask,
            output_hidden_states=True,
            return_dict=True,
        )
        h = out.hidden_states[-1]  # (B,T,H)
        pooled = self.mean_pool(h, attention_mask)  # (B,H)
        z = self.proj(pooled)  # (B,D)
        z = F.normalize(z, p=2, dim=-1)
        return z


def info_nce(z1: torch.Tensor, z2: torch.Tensor, temperature: float) -> torch.Tensor:
    # z1,z2: (B,D), normalized
    logits = (z1 @ z2.t()) / temperature  # (B,B)
    labels = torch.arange(z1.size(0), device=z1.device)
    loss_a = F.cross_entropy(logits, labels)
    loss_b = F.cross_entropy(logits.t(), labels)
    return 0.5 * (loss_a + loss_b)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base_model", required=True)
    ap.add_argument("--base_model_revision", default=None)
    ap.add_argument("--lora_dir", required=True)
    ap.add_argument("--output_dir", required=True)

    # These are what your pipeline passes (previously unrecognized)
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--batch_size", type=int, default=1)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--max_len", type=int, default=256)

    # Safety / practicality
    ap.add_argument("--max_steps", type=int, default=200)  # prevents "1 epoch" => 53k steps
    ap.add_argument("--proj_dim", type=int, default=768)
    ap.add_argument("--temperature", type=float, default=0.07)
    ap.add_argument("--seed", type=int, default=1337)

    # Optional explicit data source (if not provided we infer from runs/<id>/datasets/)
    ap.add_argument("--train_file", default=None)

    args = ap.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    if _cuda():
        torch.cuda.manual_seed_all(args.seed)

    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    os.environ.setdefault("PYTORCH_ALLOC_CONF", "expandable_segments:True,max_split_size_mb:128")

    out_dir = Path(args.output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    lora_dir = Path(args.lora_dir).resolve()
    train_file = Path(args.train_file).resolve() if args.train_file else _default_train_file_from_lora(lora_dir)
    if train_file is None or not Path(train_file).exists():
        raise SystemExit(f"[llm2vec] Could not find train_file. Provide --train_file or ensure runs/<id>/datasets/*.jsonl exists. lora_dir={lora_dir}")

    use_cuda = _cuda()
    dtype = _dtype()
    bnb_ok = _bnb_available()
    use_4bit = bool(use_cuda and bnb_ok)

    print(f"[llm2vec] base={args.base_model}")
    print(f"[llm2vec] lora_dir={lora_dir}")
    print(f"[llm2vec] train_file={train_file}")
    print(f"[llm2vec] cuda={use_cuda} bnb={bnb_ok} q4={use_4bit} dtype={dtype} cc={_cc()[0]}.{_cc()[1]}")
    print(f"[llm2vec] epochs={args.epochs} batch_size={args.batch_size} lr={args.lr} max_len={args.max_len} max_steps={args.max_steps}")

    tokenizer = AutoTokenizer.from_pretrained(args.base_model, revision=args.base_model_revision, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    model_kwargs: Dict[str, Any] = dict(revision=args.base_model_revision, device_map="auto" if use_cuda else None)

    if use_4bit:
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=dtype,
        )
        # Newer transformers prefers dtype=
        model_kwargs["dtype"] = dtype
    else:
        if use_cuda:
            model_kwargs["dtype"] = dtype

    base = AutoModelForCausalLM.from_pretrained(args.base_model, **model_kwargs)
    base.config.use_cache = False
    base.gradient_checkpointing_enable()

    # Load LoRA adapter; make it trainable (we'll only train LoRA + projection)
    model = PeftModel.from_pretrained(base, str(lora_dir), is_trainable=True)

    # Freeze everything except LoRA params
    for p in model.parameters():
        p.requires_grad = False
    for n, p in model.named_parameters():
        if "lora_" in n:
            p.requires_grad = True

    hidden_size = getattr(model.config, "hidden_size", None)
    if hidden_size is None:
        # LLaMA-like configs
        hidden_size = getattr(model.config, "dim", None)
    if hidden_size is None:
        raise SystemExit("[llm2vec] Could not infer hidden size from model config.")

    embedder = Embedder(model, int(hidden_size), int(args.proj_dim))

    # Projection head must be trainable
    for p in embedder.proj.parameters():
        p.requires_grad = True

    device = torch.device("cuda:0" if use_cuda else "cpu")
    embedder.to(device)

    # Load dataset
    ds = load_dataset("json", data_files={"train": str(train_file)}, split="train")

    # Expect "text" column (your normalized dataset has it), otherwise stringify record
    texts: List[str] = []
    if "text" in ds.column_names:
        texts = [t for t in ds["text"] if isinstance(t, str)]
    else:
        # fallback: stringify rows
        for ex in ds:
            try:
                texts.append(ex.get("text") if isinstance(ex, dict) else str(ex))
            except Exception:
                texts.append(str(ex))

    data = TextDataset(texts)
    if len(data) < 2:
        raise SystemExit(f"[llm2vec] Not enough training texts: {len(data)}")

    loader = DataLoader(
        data,
        batch_size=args.batch_size,
        shuffle=True,
        drop_last=True if args.batch_size > 1 else False,
        collate_fn=_collate_two_views(tokenizer, args.max_len),
    )

    # Optimizer on trainable params only
    params = [p for p in embedder.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=args.lr, betas=(0.9, 0.999), eps=1e-8, weight_decay=0.01)

    scaler = torch.cuda.amp.GradScaler(enabled=use_cuda and dtype == torch.float16)

    embedder.train()
    global_step = 0
    running = 0.0
    log_every = 10

    for epoch in range(args.epochs):
        for batch in loader:
            v1_ids = batch["v1_input_ids"].to(device, non_blocking=True)
            v1_attn = batch["v1_attention_mask"].to(device, non_blocking=True)
            v2_ids = batch["v2_input_ids"].to(device, non_blocking=True)
            v2_attn = batch["v2_attention_mask"].to(device, non_blocking=True)

            opt.zero_grad(set_to_none=True)

            with torch.autocast(device_type="cuda", dtype=dtype, enabled=use_cuda):
                z1 = embedder(v1_ids, v1_attn)
                z2 = embedder(v2_ids, v2_attn)
                loss = info_nce(z1, z2, args.temperature)

            if scaler.is_enabled():
                scaler.scale(loss).backward()
                scaler.unscale_(opt)
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                scaler.step(opt)
                scaler.update()
            else:
                loss.backward()
                torch.nn.utils.clip_grad_norm_(params, 1.0)
                opt.step()

            running += float(loss.item())
            global_step += 1

            if global_step % log_every == 0:
                avg = running / log_every
                running = 0.0
                print(f"[llm2vec] step={global_step} loss={avg:.4f}")

            if args.max_steps > 0 and global_step >= args.max_steps:
                break

        if args.max_steps > 0 and global_step >= args.max_steps:
            break

    # Save artifacts
    (out_dir / "adapter").mkdir(parents=True, exist_ok=True)
    embedder.base_model.save_pretrained(str(out_dir / "adapter"))
    tokenizer.save_pretrained(str(out_dir / "tokenizer"))

    torch.save(embedder.proj.state_dict(), str(out_dir / "projection.pt"))

    cfg = {
        "base_model": args.base_model,
        "base_model_revision": args.base_model_revision,
        "lora_source": str(lora_dir),
        "train_file": str(train_file),
        "proj_dim": args.proj_dim,
        "pooling": "mean_last_hidden",
        "normalize": True,
        "max_len": args.max_len,
        "temperature": args.temperature,
    }
    (out_dir / "llm2vec_config.json").write_text(json.dumps(cfg, indent=2), encoding="utf-8")

    print(f"[llm2vec] done -> {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
