#!/usr/bin/env python3
"""
offllm_symbiosis_advisor_v3.py
==============================

Purpose
-------
Given an offLLM repository (folder or zip), this script performs a *targeted*
static scan oriented around "code ↔ model" symbiosis:

1) Where should we search next? (seed paths + high-signal files)
2) What refactors tighten the runtime <-> training feedback loop?
3) What fine-tuning datasets and evals can be derived from the codebase itself?
4) What export targets are implied (MLX/CoreML/GGUF) and where are the gaps?

It is intentionally opinionated for offLLM/monGARS-style stacks:
- React Native / Expo + iOS native modules
- local LLM runtimes (MLX, llama.cpp, etc.)
- tool calling / RAG / embeddings (LLM2Vec, HNSW/FAISS-like)
- MLOps: prompt templates, telemetry, evaluation, reproducible runs

Outputs
-------
- symbiosis_plan.md : human-readable plan
- symbiosis_plan.json : machine-readable plan
- repo_index_lite.json : condensed index (files + keyword hits + hotspots)

Notes
-----
This is a static analyzer (no network). It does *not* execute project code.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import os
import re
import shutil
import sys
import tempfile
import textwrap
import time
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


# -----------------------------
# Config / heuristics
# -----------------------------

DEFAULT_EXCLUDES = {
    ".git",
    ".venv",
    "venv",
    "node_modules",
    "Pods",
    "DerivedData",
    "build",
    "dist",
    ".next",
    ".expo",
    ".turbo",
    ".cache",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
}

# "Search seeds": directories that usually contain the levers for symbiosis.
SEARCH_SEEDS = [
    "scripts",
    "src",
    "app",
    "packages",
    "ios",
    "android",
    ".github/workflows",
    "configs",
    "config",
    "mlops",
    "eval",
    "tests",
]

# Keywords grouped by "why you care".
KEYWORDS: dict[str, list[str]] = {
    "telemetry": [
        "telemetry",
        "event",
        "trace",
        "span",
        "logTelemetry",
        "metric",
        "analytics",
    ],
    "prompt_templates": [
        "promptTemplates",
        "prompt_templates",
        "golden_prompts",
        "prompt registry",
        "prompt version",
    ],
    "tool_calling": [
        "tool",
        "function_call",
        "tool_call",
        "schema",
        "zod",
        "json schema",
        "toolhandler",
    ],
    "retrieval": [
        "retrieval",
        "retriever",
        "vector",
        "embedding",
        "hnsw",
        "faiss",
        "pgvector",
        "rerank",
        "rag",
    ],
    "llm2vec": ["llm2vec", "contrastive", "triplet", "pairs_jsonl", "in-batch negatives"],
    "training": [
        "train",
        "trainer",
        "sft",
        "lora",
        "qlora",
        "peft",
        "bitsandbytes",
        "gradient",
        "warmup",
        "cosine",
    ],
    "export": [
        "export",
        "coreml",
        "mlx",
        "gguf",
        "llama.cpp",
        "quant",
        "convert",
        "mlmodel",
        "mlpackage",
    ],
    "safety_privacy": ["pii", "redact", "sanitize", "privacy", "consent", "local-only", "encryption"],
    "ci_cd": ["github actions", "workflow", "fastlane", "xcodebuild", "testflight", "app store", "codesign"],
}

# File types we treat as "code" for token/keyword scanning
CODE_EXTS = {
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".swift",
    ".m",
    ".mm",
    ".h",
    ".java",
    ".kt",
    ".json",
    ".yml",
    ".yaml",
    ".toml",
    ".ini",
    ".md",
    ".txt",
    ".sh",
    ".bash",
    ".zsh",
}

# Per-file size safety limit for reading (bytes)
MAX_READ_BYTES = 2_500_000  # 2.5MB; big enough for most code, avoids logs.


# -----------------------------
# Data model
# -----------------------------


@dataclass
class FileHit:
    path: str
    ext: str
    size_bytes: int
    loc: int
    keyword_hits: dict[str, int]
    sha1: str


@dataclass
class Hotspot:
    topic: str
    reason: str
    files: list[str]


@dataclass
class PlanSection:
    title: str
    bullets: list[str]
    evidence: list[str]


# -----------------------------
# Helpers
# -----------------------------


def _sha1_bytes(b: bytes) -> str:
    import hashlib

    h = hashlib.sha1()
    h.update(b)
    return h.hexdigest()


def _safe_read_text(path: Path) -> tuple[str, str]:
    """
    Returns (text, sha1). If file is too big or binary-ish, returns ("", sha1-of-first-chunk).
    """
    try:
        size = path.stat().st_size
    except OSError:
        return "", ""
    try:
        with path.open("rb") as f:
            raw = f.read(min(size, MAX_READ_BYTES))
        sha1 = _sha1_bytes(raw)
        # crude binary check
        if b"\x00" in raw:
            return "", sha1
        # decode
        text = raw.decode("utf-8", errors="replace")
        return text, sha1
    except Exception:
        return "", ""


def _count_loc(text: str) -> int:
    if not text:
        return 0
    return sum(1 for ln in text.splitlines() if ln.strip())


def _iter_files(root: Path) -> Iterable[Path]:
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        parts = set(p.parts)
        if parts & DEFAULT_EXCLUDES:
            continue
        yield p


def _top_n(counter: Counter[str], n: int = 8) -> list[tuple[str, int]]:
    return counter.most_common(n)


def _keyword_count(text: str, kw: str) -> int:
    # case-insensitive substring count
    if not text:
        return 0
    return len(re.findall(re.escape(kw), text, flags=re.IGNORECASE))


def _scan_file(path: Path, rel: str) -> FileHit | None:
    ext = path.suffix.lower()
    size = path.stat().st_size
    if ext and ext not in CODE_EXTS:
        return None
    # allow extension-less executable scripts
    if not ext and size > MAX_READ_BYTES:
        return None

    text, sha1 = _safe_read_text(path)
    loc = _count_loc(text)

    hits: dict[str, int] = {}
    total = 0
    for group, kws in KEYWORDS.items():
        g = 0
        for kw in kws:
            g += _keyword_count(text, kw)
        if g:
            hits[group] = g
            total += g

    # discard files with zero signal AND tiny/no code
    if not hits and loc < 5:
        return None

    return FileHit(
        path=rel,
        ext=ext or "",
        size_bytes=size,
        loc=loc,
        keyword_hits=hits,
        sha1=sha1,
    )


def _extract_zip(zip_path: Path, dst: Path) -> Path:
    with zipfile.ZipFile(zip_path, "r") as z:
        z.extractall(dst)
    # common pattern: single top folder
    children = [p for p in dst.iterdir() if p.is_dir()]
    if len(children) == 1:
        return children[0]
    return dst


def _repo_root_from_input(repo_or_zip: Path) -> Path:
    if repo_or_zip.is_dir():
        return repo_or_zip
    if repo_or_zip.is_file() and repo_or_zip.suffix.lower() == ".zip":
        tmp = Path(tempfile.mkdtemp(prefix="offllm_repo_"))
        return _extract_zip(repo_or_zip, tmp)
    raise SystemExit(f"Input must be a folder or .zip: {repo_or_zip}")


def _rank_files(files: list[FileHit]) -> list[FileHit]:
    # score: keyword signal weighted + loc
    def score(f: FileHit) -> float:
        s = 0.0
        for g, c in f.keyword_hits.items():
            # bias toward symbiosis levers
            w = {
                "telemetry": 6.0,
                "prompt_templates": 6.0,
                "retrieval": 5.0,
                "llm2vec": 5.0,
                "training": 4.0,
                "export": 4.0,
                "tool_calling": 4.0,
                "ci_cd": 2.0,
                "safety_privacy": 2.0,
            }.get(g, 1.0)
            s += w * c
        s += min(f.loc, 2000) / 200.0
        return s

    return sorted(files, key=score, reverse=True)


def _find_seeds_present(repo_root: Path) -> list[str]:
    present = []
    for s in SEARCH_SEEDS:
        if (repo_root / s).exists():
            present.append(s)
    return present


def _infer_symbiosis_gaps(files: list[FileHit]) -> list[str]:
    # crude "missing lever" detection: if topic has near-zero hits.
    totals = Counter()
    for f in files:
        for g, c in f.keyword_hits.items():
            totals[g] += c

    gaps = []

    def need(topic: str, why: str, threshold: int = 2) -> None:
        if totals[topic] < threshold:
            gaps.append(f"Missing/weak **{topic}** surface (hits={totals[topic]}): {why}")

    need("telemetry", "You want production traces -> redacted datasets -> eval & fine-tune.")
    need("prompt_templates", "Versioned prompts keep training/eval/runtime aligned.")
    need("retrieval", "Embeddings/retrieval need observability + eval sets.")
    need("llm2vec", "If you intend LLM2Vec, ensure real dependency and training loop.")
    need("export", "Exports to MLX/CoreML/GGUF should be first-class scripts + CI.")
    return gaps


def _hotspots(files: list[FileHit]) -> list[Hotspot]:
    by_topic: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for f in files:
        for t, c in f.keyword_hits.items():
            by_topic[t].append((c, f.path))

    out: list[Hotspot] = []
    for t, items in by_topic.items():
        items.sort(reverse=True)
        top = [p for _, p in items[:8]]
        if not top:
            continue
        out.append(
            Hotspot(
                topic=t,
                reason=f"Highest '{t}' keyword density (review for ownership boundaries + missing tests)",
                files=top,
            )
        )
    out.sort(
        key=lambda h: {
            "telemetry": 0,
            "prompt_templates": 1,
            "retrieval": 2,
            "training": 3,
            "export": 4,
        }.get(h.topic, 10)
    )
    return out


def _plan(files: list[FileHit], seeds: list[str]) -> list[PlanSection]:
    ranked = _rank_files(files)
    top_files = [f.path for f in ranked[:20]]
    gaps = _infer_symbiosis_gaps(files)
    hs = _hotspots(files)

    sections: list[PlanSection] = []

    sections.append(
        PlanSection(
            title="Where to search next (seed paths + top files)",
            bullets=[
                "Prioritise these directories first: "
                + ", ".join(f"`{s}/`" for s in (seeds or ["<none found>"])),
                "Then inspect these high-signal files (in order):",
                *[f"- `{p}`" for p in top_files[:12]],
            ],
            evidence=[
                f"Top file candidates computed from keyword-weighted scoring over {len(files)} scanned files."
            ],
        )
    )

    # Refactor guidance: align runtime ↔ training ↔ eval
    sections.append(
        PlanSection(
            title="Refactor targets to get 'code ↔ model' symbiosis",
            bullets=[
                "**Single source of truth for prompts**: store versioned templates in one place, "
                "and make runtime, eval, and fine-tune builders import the same registry.",
                "**Telemetry as dataset factory**: add a local-only event schema for "
                "(prompt_id, model_id, tool_calls, retrieval hits, outcome), plus redaction hooks.",
                "**Evaluation harness**: add deterministic prompt-regression tests + retrieval eval "
                "(MRR/nDCG) that run in CI on tiny fixtures.",
                "**Hard boundary between 'LLM runtime' and 'App logic'**: one adapter module owns "
                "tokenisation, sampling params, and model routing (MLX/CoreML/GGUF).",
                "**Export pipeline**: make `export/` scripts idempotent with a manifest "
                "(inputs, commit SHA, artefact hashes).",
            ],
            evidence=[f"Hotspots by topic: {', '.join(h.topic for h in hs[:6]) or 'none'}."],
        )
    )

    # Fine-tune design guidance
    sections.append(
        PlanSection(
            title="Fine-tuning plan that *uses the codebase* (and keeps it honest)",
            bullets=[
                "**SFT dataset** from: prompt templates + golden prompts + curated failures from telemetry "
                "(with redaction).",
                "**Tool-calling dataset** from: real tool schemas + recorded tool traces; train JSON-format "
                "discipline and error recovery.",
                "**Retrieval/embedding dataset** from: (query, positive_chunk, hard_negative) triples; "
                "derive hard negatives from close-by embeddings and click/selection telemetry.",
                "**LLM2Vec**: only if you have the real library + a contrastive training loop; "
                "otherwise ship a stable embedding model first and add LLM2Vec later.",
                "**Eval gating**: never accept a fine-tune unless it beats baseline on: "
                "(a) prompt-regression, (b) tool JSON validity, (c) retrieval MRR/nDCG, "
                "(d) latency/VRAM budgets.",
            ],
            evidence=[
                "This section is heuristic; it points to the minimal closed-loop that prevents "
                "'train random stuff' syndrome."
            ],
        )
    )

    if gaps:
        sections.append(
            PlanSection(
                title="Gaps detected (likely why the pipeline feels 'simplified')",
                bullets=[f"- {g}" for g in gaps],
                evidence=["Keyword-surface heuristics over scanned code (not perfect, but good at spotting missing levers)."],
            )
        )

    # Concrete actions from hotspots
    for h in hs[:8]:
        sections.append(
            PlanSection(
                title=f"Hotspot: {h.topic}",
                bullets=[f"- Review: `{p}`" for p in h.files],
                evidence=[h.reason],
            )
        )

    return sections


def _render_md(
    repo_root: Path, files: list[FileHit], seeds: list[str], sections: list[PlanSection]
) -> str:
    ranked = _rank_files(files)
    counts_by_ext = Counter(f.ext or "<none>" for f in files)
    biggest = sorted(files, key=lambda f: f.size_bytes, reverse=True)[:8]

    now = time.strftime("%Y-%m-%d %H:%M:%S")
    out = []
    out.append("# offLLM Symbiosis Plan (v3)\n")
    out.append(
        f"- Repo: `{repo_root}`\n- Generated: `{now}`\n- Files scanned (code-like): **{len(files)}**\n"
    )
    out.append("## Quick stats\n")
    out.append(
        "**Top extensions**: "
        + ", ".join(f"`{ext}` ({n})" for ext, n in _top_n(counts_by_ext, 10))
        + "\n"
    )
    out.append(
        "**Largest scanned files**:\n"
        + "\n".join(f"- `{f.path}` ({f.size_bytes/1_000_000:.2f} MB)" for f in biggest)
        + "\n"
    )

    out.append("## Plan\n")
    for s in sections:
        out.append(f"### {s.title}\n")
        for b in s.bullets:
            out.append(f"- {b}")
        if s.evidence:
            out.append("\n**Evidence**:")
            for e in s.evidence:
                out.append(f"- {e}")
        out.append("")
    out.append("## Appendix: ranked file list (top 40)\n")
    for f in ranked[:40]:
        hits = ", ".join(
            f"{k}:{v}" for k, v in sorted(f.keyword_hits.items(), key=lambda x: -x[1])
        ) or "-"
        out.append(f"- `{f.path}` — loc={f.loc} size={f.size_bytes} hits=[{hits}]")
    out.append("")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="Path to repo folder or .zip")
    ap.add_argument("--out-dir", default=".", help="Output directory")
    ap.add_argument(
        "--include-noncode",
        action="store_true",
        help="Scan all file extensions (slower, more noise)",
    )
    args = ap.parse_args(argv)

    repo_in = Path(args.repo).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    repo_root = _repo_root_from_input(repo_in)
    seeds = _find_seeds_present(repo_root)

    files: list[FileHit] = []
    for p in _iter_files(repo_root):
        rel = str(p.relative_to(repo_root))
        ext = p.suffix.lower()
        if not args.include_noncode and ext and ext not in CODE_EXTS:
            continue
        hit = _scan_file(p, rel)
        if hit:
            files.append(hit)

    # Build plan
    sections = _plan(files, seeds)

    # Write outputs
    md = _render_md(repo_root, files, seeds, sections)
    (out_dir / "symbiosis_plan.md").write_text(md, encoding="utf-8")
    # Minimal repo index for other tools
    repo_index = {
        "repo_root": str(repo_root),
        "seeds": seeds,
        "files_scanned": len(files),
        "files": [dataclasses.asdict(f) for f in files],
    }
    (out_dir / "repo_index_lite.json").write_text(
        json.dumps(repo_index, indent=2), encoding="utf-8"
    )

    # fix up JSON (avoid the dataclasses.asdict function accidentally dumped above)
    plan_json = {
        "repo_root": str(repo_root),
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "seeds": seeds,
        "sections": [dataclasses.asdict(s) for s in sections],
    }
    (out_dir / "symbiosis_plan.json").write_text(
        json.dumps(plan_json, indent=2), encoding="utf-8"
    )

    print(f"[symbiosis_v3] wrote -> {out_dir/'symbiosis_plan.md'}")
    print(f"[symbiosis_v3] wrote -> {out_dir/'symbiosis_plan.json'}")
    print(f"[symbiosis_v3] wrote -> {out_dir/'repo_index_lite.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
