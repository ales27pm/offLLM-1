"""
Core ML conversion utility for Dolphin models.

Environment:
    HF_TOKEN (optional): Hugging Face access token required when the source
    model is gated. You can also pass the same value via --hf_token when
    invoking this script manually, for example:

        HF_TOKEN=hf_xxx python scripts/convert_to_coreml.py \
            --hf_model cognitivecomputations/Dolphin3.0-Llama3.2-3B \
            --out_prefix build/Dolphin3
"""

import argparse
import json
import os
import warnings

import coremltools as ct
import coremltools.optimize as cto
import numpy as np
import torch
from huggingface_hub import login
from transformers import AutoConfig, AutoModelForCausalLM
from transformers.cache_utils import Cache

warnings.filterwarnings("ignore", category=FutureWarning)


class SliceUpdateKeyValueCache(Cache):
    def __init__(self, *, shape, dtype=torch.float32):
        super().__init__()
        self.register_buffer("k", torch.zeros(shape, dtype=dtype))
        self.register_buffer("v", torch.zeros(shape, dtype=dtype))
        self.register_buffer(
            "_current_length",
            torch.zeros(shape[0], dtype=torch.int32),
            persistent=False,
        )

    def __len__(self):
        return int(self._current_length.max().item())

    def update(self, k_state, v_state, layer_idx, cache_kwargs=None):
        position = (cache_kwargs or {}).get("cache_position", None)
        if position is None:
            raise ValueError("cache_position required")
        position = torch.as_tensor(position)
        if position.ndim > 1:
            position = position.reshape(-1)
        start = int(position.min().item())
        end = int(position.max().item() + 1)
        seq_len = k_state.shape[2]
        if end - start != seq_len:
            raise ValueError(
                "cache_position must describe a contiguous range matching the incoming sequence length"
            )
        if end > self.k.shape[3]:
            raise ValueError("cache_position exceeds allocated cache size")
        self.k[layer_idx, :, : k_state.shape[1], start:end, :] = k_state
        self.v[layer_idx, :, : v_state.shape[1], start:end, :] = v_state
        current = max(int(self._current_length[layer_idx].item()), end)
        self._current_length[layer_idx] = torch.tensor(
            current,
            device=self._current_length.device,
            dtype=self._current_length.dtype,
        )
        return (
            self.k[layer_idx, :, :, :current, :],
            self.v[layer_idx, :, :, :current, :],
        )

    def get_seq_length(self, _=0):
        return int(self._current_length.max().item())


def convert(
    hf_model_path: str,
    out_prefix: str,
    artifacts_path: str = "coreml_artifacts.json",
    hf_token: str | None = None,
):
    if hf_token:
        try:
            login(token=hf_token)
            print("Authenticated with Hugging Face Hub")
        except Exception as exc:  # pragma: no cover - hub failures bubble up
            raise RuntimeError(
                "Failed to authenticate with Hugging Face Hub"
            ) from exc

    config = AutoConfig.from_pretrained(hf_model_path)
    base_model = AutoModelForCausalLM.from_pretrained(
        hf_model_path,
        torch_dtype=torch.float16,
    )
    base_model.eval()

    num_layers = getattr(config, "num_hidden_layers", None)
    if num_layers is None:
        base_layers = getattr(getattr(base_model, "model", None), "layers", None)
        if base_layers is None:
            raise AttributeError(
                "Unable to determine number of decoder layers from model or config",
            )
        num_layers = len(base_layers)
    num_key_value_heads = getattr(config, "num_key_value_heads", None)
    if num_key_value_heads is None:
        num_key_value_heads = getattr(
            config,
            "num_attention_heads",
            getattr(config, "n_head", None),
        )
    if num_key_value_heads is None:
        raise AttributeError(
            "Model config is missing num_key_value_heads/num_attention_heads information",
        )
    num_attention_heads = getattr(
        config,
        "num_attention_heads",
        getattr(config, "n_head", None),
    )
    if num_attention_heads is None:
        raise AttributeError(
            "Model config is missing num_attention_heads/n_head information",
        )
    head_dim = config.hidden_size // num_attention_heads
    batch_size, context_length = 1, 256
    kv_shape = (
        num_layers,
        batch_size,
        num_key_value_heads,
        context_length,
        head_dim,
    )

    class Wrapper(torch.nn.Module):
        def __init__(self, model):
            super().__init__()
            self.model = model
            self.kv = SliceUpdateKeyValueCache(shape=kv_shape, dtype=torch.float16)

        @torch.no_grad()
        def forward(self, input_ids, attention_mask, cache_position):
            out = self.model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                past_key_values=self.kv,
                cache_position=cache_position,
                use_cache=True,
            )
            return out.logits

    wrapped_model = Wrapper(base_model).eval()
    example_input_ids = torch.zeros((batch_size, 1), dtype=torch.int32)
    example_attention_mask = torch.ones((batch_size, 1), dtype=torch.int32)
    example_cache_position = torch.tensor([0], dtype=torch.int32)

    with torch.inference_mode():
        traced = torch.jit.trace(
            wrapped_model,
            (example_input_ids, example_attention_mask, example_cache_position),
            check_trace=False,
        )

    sequence_range = ct.RangeDim(lower_bound=1, upper_bound=context_length, default=1)
    inputs = [
        ct.TensorType("input_ids", (batch_size, sequence_range), np.int32),
        ct.TensorType("attention_mask", (batch_size, sequence_range), np.int32),
        ct.TensorType("cache_position", (sequence_range,), np.int32),
    ]
    outputs = [ct.TensorType("logits", dtype=np.float16)]

    mlpackage_model = ct.convert(
        traced,
        inputs=inputs,
        outputs=outputs,
        convert_to="mlprogram",
        compute_units=ct.ComputeUnit.CPU_AND_NE,
        minimum_deployment_target=ct.target.iOS18,
        skip_model_load=True,
    )

    artifacts = []

    def save_package(model, suffix):
        name = f"{out_prefix}-{suffix}.mlpackage"
        model.save(name)
        total_bytes = 0
        for root, _, files in os.walk(name):
            for file_name in files:
                total_bytes += os.path.getsize(os.path.join(root, file_name))
        artifacts.append({"file": name, "bytes": total_bytes})

    quantization_steps = [
        ("fp16", lambda m: m),
        (
            "int8",
            lambda m: cto.coreml.linear_quantize_weights(
                m,
                config=cto.coreml.OptimizationConfig(
                    global_config=cto.coreml.OpLinearQuantizerConfig(
                        mode="linear_symmetric",
                    ),
                ),
            ),
        ),
        (
            "int4-lut",
            lambda m: cto.coreml.palettize_weights(
                m,
                config=cto.coreml.OptimizationConfig(
                    global_config=cto.coreml.OpPalettizerConfig(
                        mode="kmeans",
                        nbits=4,
                    ),
                ),
            ),
        ),
    ]

    last_successful_model = mlpackage_model
    for suffix, quantize in quantization_steps:
        try:
            candidate = quantize(mlpackage_model)
        except Exception as exc:  # noqa: BLE001 - upstream tooling raises many types
            print(
                f"Quantization '{suffix}' failed ({exc}); exporting previous precision."
            )
            model_to_save = last_successful_model
        else:
            model_to_save = candidate
            last_successful_model = model_to_save
        save_package(model_to_save, suffix)

    with open(artifacts_path, "w") as f:
        json.dump({"artifacts": artifacts}, f, indent=2)
    print(
        f"Artifacts written to {artifacts_path}:",
        json.dumps(artifacts, indent=2),
    )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--hf_model", required=True)
    ap.add_argument("--out_prefix", required=True)
    ap.add_argument("--artifacts_path", default="coreml_artifacts.json")
    ap.add_argument("--hf_token")
    args = ap.parse_args()
    token = args.hf_token or os.getenv("HF_TOKEN")
    convert(args.hf_model, args.out_prefix, args.artifacts_path, token)



