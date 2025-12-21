#!/usr/bin/env python3
"""
offllm_symbiosis_advisor_v4.py
==============================

Repo-aware symbiosis advisor:
- Scans the repository for high-signal areas (prompts, tools, telemetry, retrieval).
- Emits actionable refactor + training alignment plan.
- Produces a lightweight searchable index for downstream tooling.
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import textwrap
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

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

KEYWORDS: dict[str, list[str]] = {
    "prompts": ["prompt", "promptTemplates", "prompt_templates", "golden_prompts"],
    "tools": ["tool", "tool_call", "toolhandler", "schema", "function_call"],
    "telemetry": ["telemetry", "event", "trace", "span", "analytics", "metric"],
    "retrieval": ["retrieval", "vector", "embedding", "hnsw", "rerank", "rag"],
    "training": ["train", "trainer", "sft", "lora", "peft", "qlora"],
    "eval": ["eval", "regression", "golden", "prompt regression"],
    "export": ["coreml", "mlx", "gguf", "quant", "convert", "mlpackage"],
    "security": ["sanitize", "redact", "injection", "guardrail", "consent"],
}


@dataclass
class FileHit:
    path: str
    ext: str
    size_bytes: int
    loc: int
    keyword_hits: dict[str, int]
    sha1: str


def iter_files(root: Path, max_files: int) -> Iterable[Path]:
    count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in DEFAULT_EXCLUDES]
        for name in filenames:
            if count >= max_files:
                return
            path = Path(dirpath) / name
            if path.suffix.lower() in CODE_EXTS:
                yield path
                count += 1


def read_file(path: Path, max_bytes: int = 2_500_000) -> str:
    with path.open("rb") as handle:
        data = handle.read(max_bytes)
    return data.decode("utf-8", errors="ignore")


def sha1_text(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8", errors="ignore")).hexdigest()


def scan_repo(root: Path, max_files: int) -> list[FileHit]:
    hits: list[FileHit] = []
    for path in iter_files(root, max_files):
        text = read_file(path)
        lower = text.lower()
        keyword_hits: dict[str, int] = {}
        for group, needles in KEYWORDS.items():
            count = 0
            for needle in needles:
                count += lower.count(needle.lower())
            if count:
                keyword_hits[group] = count
        hits.append(
            FileHit(
                path=str(path.relative_to(root)),
                ext=path.suffix.lower(),
                size_bytes=path.stat().st_size,
                loc=text.count("\n") + 1,
                keyword_hits=keyword_hits,
                sha1=sha1_text(text),
            )
        )
    return hits


def rank_hotspots(hits: list[FileHit]) -> dict[str, list[dict[str, object]]]:
    grouped: dict[str, list[FileHit]] = defaultdict(list)
    for hit in hits:
        for group in hit.keyword_hits:
            grouped[group].append(hit)

    ranked: dict[str, list[dict[str, object]]] = {}
    for group, items in grouped.items():
        items_sorted = sorted(
            items,
            key=lambda item: (item.keyword_hits.get(group, 0), item.loc),
            reverse=True,
        )
        ranked[group] = [
            {
                "path": item.path,
                "hits": item.keyword_hits.get(group, 0),
                "loc": item.loc,
            }
            for item in items_sorted[:12]
        ]
    return ranked


def build_plan(hits: list[FileHit]) -> dict[str, object]:
    totals = Counter()
    for hit in hits:
        totals.update(hit.keyword_hits)

    return {
        "summary": {
            "files_scanned": len(hits),
            "keyword_totals": dict(totals),
        },
        "focus_areas": rank_hotspots(hits),
        "actions": [
            {
                "area": "telemetry",
                "recommendation": "Normalize telemetry events and map them to SFT + retrieval pairs.",
            },
            {
                "area": "prompts",
                "recommendation": "Centralize prompt templates and log prompt version IDs.",
            },
            {
                "area": "tools",
                "recommendation": "Align tool schemas with runtime ToolRegistry metadata to reduce drift.",
            },
            {
                "area": "retrieval",
                "recommendation": "Align chunking and embedding configs with LLM2Vec training.",
            },
            {
                "area": "eval",
                "recommendation": "Promote golden prompts into regression tests and MLOps reports.",
            },
        ],
    }


def write_report(out_dir: Path, plan: dict[str, object], hits: list[FileHit]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "symbiosis_report.md"
    plan_path = out_dir / "symbiosis_plan.json"
    index_path = out_dir / "repo_index.json"

    plan_path.write_text(json.dumps(plan, indent=2))
    index_path.write_text(
        json.dumps([dataclasses.asdict(hit) for hit in hits], indent=2)
    )

    sections = []
    sections.append("# offLLM Symbiosis Report (v4)\n")
    sections.append("## Summary\n")
    sections.append(f"- Files scanned: {plan['summary']['files_scanned']}\n")
    sections.append("## Focus Areas\n")
    for group, items in plan["focus_areas"].items():
        sections.append(f"### {group}\n")
        if not items:
            sections.append("- No hotspots detected.\n")
            continue
        for item in items:
            sections.append(
                f"- `{item['path']}` (hits: {item['hits']}, loc: {item['loc']})\n"
            )
    sections.append("## Recommended Actions\n")
    for action in plan["actions"]:
        sections.append(f"- **{action['area']}**: {action['recommendation']}\n")

    report_path.write_text("".join(sections))


def main() -> int:
    parser = argparse.ArgumentParser(description="offLLM Symbiosis Advisor v4")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--max-files", type=int, default=20000)
    args = parser.parse_args()

    repo_root = Path(args.repo_root).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser()
    if not out_dir.is_absolute():
        out_dir = repo_root / out_dir

    hits = scan_repo(repo_root, args.max_files)
    plan = build_plan(hits)
    write_report(out_dir, plan, hits)

    print(
        textwrap.dedent(
            f"""
            ✅ Symbiosis report written to {out_dir}
            - symbiosis_report.md
            - symbiosis_plan.json
            - repo_index.json
            """
        ).strip()
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
