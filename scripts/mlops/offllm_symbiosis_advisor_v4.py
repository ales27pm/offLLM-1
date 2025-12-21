#!/usr/bin/env python3
"""
offllm_symbiosis_advisor_v4.py
==============================

A repo-aware "symbiosis" advisor: it scans the offLLM codebase and produces
actionable guidance for:

1) Where to search (the map of "interesting places" in the repo)
2) Refactor opportunities (duplication, sharp edges, missing seams)
3) Fine-tuning & evaluation alignment ("model + code" working in symbiosis)

It is intentionally dependency-light (stdlib only). The output is deterministic:
given the same repo, it will generate the same report.

Usage
-----
python scripts/mlops/offllm_symbiosis_advisor_v4.py \
  --repo-root . \
  --out-dir runs/symbiosis/20251221_foo \
  --max-files 20000

Outputs
-------
- symbiosis_report.md
- symbiosis_plan.json
- repo_index.json (lightweight searchable index)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Optional


# -------------------------------
# Utilities
# -------------------------------

TEXT_EXTS = {
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".md",
    ".json",
    ".yml",
    ".yaml",
    ".toml",
    ".swift",
    ".m",
    ".mm",
    ".h",
    ".hpp",
    ".cc",
    ".cpp",
    ".c",
    ".rs",
    ".java",
    ".gradle",
    ".kt",
    ".kts",
    ".sh",
    ".rb",
    ".txt",
}

BINARY_EXTS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".mp4",
    ".mov",
    ".zip",
    ".a",
    ".o",
    ".so",
    ".dylib",
    ".framework",
    ".xcarchive",
    ".ipa",
    ".jar",
    ".aar",
    ".pdf",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
}

SKIP_DIR_NAMES = {
    ".git",
    ".hg",
    ".svn",
    "__pycache__",
    ".venv",
    "venv",
    "node_modules",
    "Pods",
    "build",
    "dist",
    ".gradle",
    ".idea",
    ".vscode",
    ".DS_Store",
}

DEFAULT_LIMIT_BYTES = 1_500_000  # avoid slurping giant files


def sha1_bytes(b: bytes) -> str:
    h = hashlib.sha1()
    h.update(b)
    return h.hexdigest()


def safe_read_text(path: Path, limit_bytes: int = DEFAULT_LIMIT_BYTES) -> str:
    try:
        data = path.read_bytes()
    except Exception:
        return ""
    if len(data) > limit_bytes:
        data = data[:limit_bytes]
    try:
        return data.decode("utf-8", errors="replace")
    except Exception:
        return ""


def rel(repo_root: Path, p: Path) -> str:
    try:
        return str(p.relative_to(repo_root))
    except Exception:
        return str(p)


def is_probably_binary(path: Path) -> bool:
    ext = path.suffix.lower()
    if ext in BINARY_EXTS:
        return True
    return False


def walk_repo(repo_root: Path, max_files: int) -> list[Path]:
    out: list[Path] = []
    for root, dirs, files in os.walk(repo_root):
        # prune
        dirs[:] = [d for d in dirs if d not in SKIP_DIR_NAMES]
        for fn in files:
            p = Path(root) / fn
            if len(out) >= max_files:
                return out
            out.append(p)
    return out


# -------------------------------
# Feature extraction
# -------------------------------

PROMPT_MARKERS = [
    "SYSTEM_PROMPT",
    "system prompt",
    "You are",
    "### Instruction",
    "### Response",
    "prompt_template",
    "PROMPT_TEMPLATE",
    "few-shot",
    "chain-of-thought",
    "tool_calls",
    "function_call",
    "ReAct",
    "scratchpad",
    "tool parser",
]

TOOL_MARKERS = [
    "tool",
    "tools",
    "tool_call",
    "call_tool",
    "ToolHandler",
    "ToolParser",
    "function_call",
    "schema",
    "jsonschema",
]

TELEMETRY_MARKERS = [
    "telemetry",
    "trace",
    "span",
    "opentelemetry",
    "metrics",
    "prometheus",
    "statsd",
    "sentry",
    "event_name",
    "eventType",
    "log_event",
    "structured log",
]

RAG_MARKERS = [
    "embedding",
    "vector",
    "hnsw",
    "faiss",
    "pgvector",
    "retrieval",
    "rerank",
    "reranker",
    "chunk",
    "chunking",
    "similarity",
    "cosine",
]

EVAL_MARKERS = [
    "eval",
    "evaluation",
    "benchmark",
    "golden",
    "regression",
    "score",
    "accuracy",
    "mmlu",
    "truthful",
    "bleu",
    "rouge",
    "pass@",
    "unit test",
]

IOS_MARKERS = [
    "CoreML",
    "coreml",
    "mlmodel",
    "MLModel",
    "mlx",
    "Metal",
    "ANE",
    "Xcode",
    "xcworkspace",
    "xcodebuild",
]

SECURITY_MARKERS = [
    "sanitize",
    "redact",
    "secret",
    "token",
    "apikey",
    "api_key",
    "PII",
    "prompt injection",
    "injection",
    "ssrf",
    "rce",
    "sandbox",
    "allowlist",
]


@dataclass(frozen=True)
class FileSignals:
    path: str
    ext: str
    size: int
    sha1: str
    markers: dict[str, int]
    imports: list[str]
    exports: list[str]
    contains_todo: bool


IMPORT_RE_PY = re.compile(
    r"^\s*(?:from\s+([a-zA-Z0-9_\.]+)\s+import|import\s+([a-zA-Z0-9_\.]+))",
    re.M,
)
IMPORT_RE_JS = re.compile(r"^\s*import\s+.*?\s+from\s+['\"]([^'\"]+)['\"]\s*;?", re.M)
REQUIRE_RE_JS = re.compile(r"require\(\s*['\"]([^'\"]+)['\"]\s*\)")
EXPORT_RE_JS = re.compile(r"^\s*export\s+(?:default\s+)?", re.M)


def count_markers(text: str, markers: list[str]) -> int:
    low = text.lower()
    n = 0
    for m in markers:
        n += low.count(m.lower())
    return n


def extract_imports_exports(path: Path, text: str) -> tuple[list[str], list[str]]:
    ext = path.suffix.lower()
    imports: list[str] = []
    exports: list[str] = []
    if ext == ".py":
        for a, b in IMPORT_RE_PY.findall(text):
            mod = a or b
            if mod:
                imports.append(mod)
    elif ext in {".js", ".ts", ".tsx", ".jsx"}:
        imports.extend(IMPORT_RE_JS.findall(text))
        imports.extend(REQUIRE_RE_JS.findall(text))
        if EXPORT_RE_JS.search(text):
            exports.append("export")
    return sorted(set(imports)), sorted(set(exports))


def signals_for_file(
    repo_root: Path, p: Path, limit_bytes: int
) -> Optional[FileSignals]:
    try:
        st = p.stat()
    except Exception:
        return None
    if p.is_dir():
        return None
    if is_probably_binary(p):
        return None
    ext = p.suffix.lower()
    if ext and ext not in TEXT_EXTS:
        # still allow extension-less scripts / configs
        if ext != "":
            return None

    raw = b""
    try:
        raw = p.read_bytes()
    except Exception:
        return None
    sha1 = sha1_bytes(raw)
    if len(raw) > limit_bytes:
        raw = raw[:limit_bytes]
    try:
        text = raw.decode("utf-8", errors="replace")
    except Exception:
        text = ""

    markers = {
        "prompts": count_markers(text, PROMPT_MARKERS),
        "tools": count_markers(text, TOOL_MARKERS),
        "telemetry": count_markers(text, TELEMETRY_MARKERS),
        "rag": count_markers(text, RAG_MARKERS),
        "eval": count_markers(text, EVAL_MARKERS),
        "ios": count_markers(text, IOS_MARKERS),
        "security": count_markers(text, SECURITY_MARKERS),
    }
    imports, exports = extract_imports_exports(p, text)
    contains_todo = ("TODO" in text) or ("FIXME" in text) or ("HACK" in text)

    return FileSignals(
        path=rel(repo_root, p),
        ext=ext or "<none>",
        size=int(st.st_size),
        sha1=sha1,
        markers=markers,
        imports=imports,
        exports=exports,
        contains_todo=contains_todo,
    )


# -------------------------------
# Analysis & Plan
# -------------------------------


@dataclass
class SearchMap:
    prompts: list[str]
    tools: list[str]
    telemetry: list[str]
    rag: list[str]
    eval: list[str]
    ios: list[str]
    security: list[str]


@dataclass
class RefactorFinding:
    title: str
    severity: str  # low/med/high
    why: str
    where: list[str]
    suggested_actions: list[str]


@dataclass
class FineTuneAxis:
    axis: str
    goal: str
    dataset_sources: list[str]
    evals: list[str]
    notes: str


@dataclass
class SymbiosisPlan:
    generated_at: str
    repo_root: str
    repo_fingerprint: str
    totals: dict[str, Any]
    search_map: SearchMap
    refactor_findings: list[RefactorFinding]
    finetune_axes: list[FineTuneAxis]


def fingerprint_repo(repo_root: Path, file_sigs: list[FileSignals]) -> str:
    # deterministic fingerprint from sorted (path, sha1)
    h = hashlib.sha1()
    for fs in sorted(file_sigs, key=lambda x: x.path):
        h.update(fs.path.encode("utf-8"))
        h.update(fs.sha1.encode("utf-8"))
    return h.hexdigest()


def top_paths(file_sigs: list[FileSignals], key: str, k: int = 20) -> list[str]:
    scored = [
        (fs.markers.get(key, 0), fs.path)
        for fs in file_sigs
        if fs.markers.get(key, 0) > 0
    ]
    scored.sort(reverse=True)
    return [p for _, p in scored[:k]]


def build_search_map(file_sigs: list[FileSignals]) -> SearchMap:
    return SearchMap(
        prompts=top_paths(file_sigs, "prompts", 35),
        tools=top_paths(file_sigs, "tools", 35),
        telemetry=top_paths(file_sigs, "telemetry", 35),
        rag=top_paths(file_sigs, "rag", 35),
        eval=top_paths(file_sigs, "eval", 35),
        ios=top_paths(file_sigs, "ios", 35),
        security=top_paths(file_sigs, "security", 35),
    )


def find_dup_candidates(
    file_sigs: list[FileSignals], key: str, min_hits: int = 3
) -> dict[str, list[str]]:
    # quick-and-dirty "duplication smell": many files with the same marker set > threshold
    buckets: dict[str, list[str]] = {}
    for fs in file_sigs:
        if fs.markers.get(key, 0) >= min_hits:
            bucket_key = f"{key}:{min_hits}"
            buckets.setdefault(bucket_key, []).append(fs.path)
    return buckets


def build_refactor_findings(
    repo_root: Path, file_sigs: list[FileSignals], search: SearchMap
) -> list[RefactorFinding]:
    findings: list[RefactorFinding] = []

    # 1) Prompt & tool surfaces: encourage single schema & versioned templates
    if len(search.prompts) > 0:
        findings.append(
            RefactorFinding(
                title="Unify prompt surfaces into versioned templates",
                severity="high",
                why=(
                    "Multiple prompt definitions scattered across the repo tend to drift. "
                    "Drift breaks fine-tuning, evaluation, and runtime behaviour alignment."
                ),
                where=search.prompts[:12],
                suggested_actions=[
                    "Create a single prompt-template registry (e.g. prompts/v1/*.json) with explicit versioning.",
                    "Have runtime load prompts by ID+version; log prompt_id+version into telemetry for every generation.",
                    "Add a lint step that fails CI if new hardcoded system prompts are added outside the registry.",
                ],
            )
        )

    # 2) Telemetry: enforce schema and redaction policy
    if len(search.telemetry) > 0:
        findings.append(
            RefactorFinding(
                title="Standardise telemetry schema and redaction",
                severity="high",
                why=(
                    "Telemetry is the bridge between 'what the app did' and 'what the model should learn'. "
                    "Without stable schema + redaction, you can't safely build SFT/RAG datasets from real usage."
                ),
                where=search.telemetry[:12],
                suggested_actions=[
                    "Define an event schema (JSON Schema / zod) for model interactions: input, output, tool_calls, latencies, errors.",
                    "Centralise PII redaction: strip secrets, emails, keys; hash stable identifiers.",
                    "Write telemetry→datasets transforms: telemetry→SFT JSONL, telemetry→retrieval pairs, telemetry→eval cases.",
                ],
            )
        )

    # 3) RAG: identify and isolate vector / retrieval logic
    if len(search.rag) > 0:
        findings.append(
            RefactorFinding(
                title="Isolate retrieval and chunking into a single library surface",
                severity="med",
                why=(
                    "Retrieval quality depends on stable chunking and embedding settings. "
                    "Scattered implementations cause mismatch between offline indexing and runtime retrieval."
                ),
                where=search.rag[:12],
                suggested_actions=[
                    "Extract chunking rules into one module with golden tests (same input → same chunks).",
                    "Log retrieval traces into telemetry (query, top-k ids, scores, reranker decisions).",
                    "Train embeddings/LLM2Vec using the same chunk distribution you use at runtime.",
                ],
            )
        )

    # 4) Evaluations: demand a local harness and golden set
    if len(search.eval) > 0:
        findings.append(
            RefactorFinding(
                title="Make evaluation first-class (golden set + regression gates)",
                severity="high",
                why=(
                    "Fine-tuning without a regression gate is just vibe-training. "
                    "A small but strict eval harness catches prompt drift and tool regressions early."
                ),
                where=search.eval[:12],
                suggested_actions=[
                    "Create a golden eval suite: tool parsing, JSON validity, citation behaviour, refusal correctness.",
                    "Add offline eval CLI and a CI job that runs it on every PR.",
                    "Version eval cases alongside prompt templates; tie eval metrics to releases.",
                ],
            )
        )

    # 5) Security posture (prompt injection & tool safety)
    if len(search.security) > 0 or len(search.tools) > 0:
        findings.append(
            RefactorFinding(
                title="Harden tool-calling boundaries and injection resistance",
                severity="med",
                why=(
                    "Tool-calling is the highest-risk surface. Harden parsing, allowlists, and sandboxing. "
                    "Then fine-tune specifically on tool-safe behaviours and refusal patterns."
                ),
                where=(search.tools[:8] + search.security[:8])[:12],
                suggested_actions=[
                    "Enforce JSON schema validation for tool arguments before execution.",
                    "Add allowlist + capability-based tool routing (tools exposed depend on context).",
                    "Add a red-team eval set: prompt injection, data exfil attempts, schema smuggling.",
                ],
            )
        )

    # 6) TODO / FIXME hotspots
    todo_files = [fs.path for fs in file_sigs if fs.contains_todo]
    if todo_files:
        todo_files.sort()
        findings.append(
            RefactorFinding(
                title="Pay down TODO/FIXME hotspots that sit on critical paths",
                severity="low",
                why="TODOs in orchestration, retrieval, and export paths tend to become latent production bugs.",
                where=todo_files[:20],
                suggested_actions=[
                    "Classify TODOs: (a) correctness, (b) perf, (c) security, (d) UX; then address in that order.",
                    "Convert top TODOs into tracked issues with acceptance tests.",
                ],
            )
        )

    return findings


def build_finetune_axes(search: SearchMap) -> list[FineTuneAxis]:
    # This is deterministic but still "policy"—it suggests a rational alignment.
    axes: list[FineTuneAxis] = []

    axes.append(
        FineTuneAxis(
            axis="Tool calling & JSON robustness",
            goal="Valid tool JSON, correct tool selection, safe refusal when schema cannot be satisfied.",
            dataset_sources=(
                ["telemetry: tool_calls + outcomes"]
                + (["code: tool schemas + handlers"] if search.tools else [])
            ),
            evals=[
                "tool-json-validity@k",
                "tool-selection-accuracy",
                "refusal-correctness",
            ],
            notes=(
                "Train with 'observations' (tool results) to prevent the model from hallucinating tool outputs. "
                "Include negative examples where tool args are malicious or invalid."
            ),
        )
    )

    axes.append(
        FineTuneAxis(
            axis="Retrieval-aware answering (RAG discipline)",
            goal="Use retrieved context correctly; cite, quote minimally, and say 'I don't know' when absent.",
            dataset_sources=(
                ["telemetry: retrieval traces + final answers"]
                + (["code: chunking + embedding configs"] if search.rag else [])
            ),
            evals=[
                "context-groundedness",
                "citation-precision",
                "hallucination-rate",
            ],
            notes=(
                "If chunking changes, regenerate retrieval pairs and re-run evals. "
                "Align embedding model + tokenization with runtime settings."
            ),
        )
    )

    axes.append(
        FineTuneAxis(
            axis="Product voice + prompt adherence",
            goal="Consistent style, safety rules, and system prompt compliance across versions.",
            dataset_sources=(
                ["prompt_registry: versioned templates"]
                if search.prompts
                else ["existing prompts in repo"]
            ),
            evals=[
                "prompt-adherence",
                "format-compliance",
            ],
            notes="Treat prompts as API: version them, test them, and log them.",
        )
    )

    axes.append(
        FineTuneAxis(
            axis="French bilingual capability",
            goal="High-quality French understanding and generation with Canadian French robustness.",
            dataset_sources=[
                "HF French corpora (cleaned)",
                "your internal French docs + UI strings",
                "telemetry from francophone usage (after redaction)",
            ],
            evals=[
                "fr-grammar-score (heuristic)",
                "fr-instruction-following",
            ],
            notes="Prefer curated, domain-relevant French data. Avoid mixing in noisy web text without filtering.",
        )
    )

    return axes


def write_markdown(plan: SymbiosisPlan, out_md: Path) -> None:
    sm = plan.search_map
    lines: list[str] = []
    lines.append("# offLLM Symbiosis Report\n")
    lines.append(f"- Generated: **{plan.generated_at}**")
    lines.append(f"- Repo root: `{plan.repo_root}`")
    lines.append(f"- Repo fingerprint: `{plan.repo_fingerprint}`")
    lines.append("")
    lines.append("## Totals")
    for k, v in plan.totals.items():
        lines.append(f"- **{k}**: {v}")
    lines.append("")
    lines.append("## Where to search\n")

    def section(title: str, items: list[str]) -> None:
        lines.append(f"### {title}")
        if not items:
            lines.append("_No strong signals found._\n")
            return
        for p in items[:25]:
            lines.append(f"- `{p}`")
        if len(items) > 25:
            lines.append(f"- … and {len(items) - 25} more")
        lines.append("")

    section("Prompts", sm.prompts)
    section("Tools / Orchestration", sm.tools)
    section("Telemetry", sm.telemetry)
    section("Retrieval / RAG", sm.rag)
    section("Evaluation", sm.eval)
    section("iOS / MLX / CoreML", sm.ios)
    section("Security", sm.security)

    lines.append("## Refactor findings\n")
    for f in plan.refactor_findings:
        lines.append(f"### {f.title} ({f.severity})")
        lines.append(f"**Why:** {f.why}")
        if f.where:
            lines.append("**Where:**")
            for p in f.where[:12]:
                lines.append(f"- `{p}`")
        lines.append("**Suggested actions:**")
        for a in f.suggested_actions:
            lines.append(f"- {a}")
        lines.append("")

    lines.append("## Fine-tuning axes (code + model symbiosis)\n")
    for ax in plan.finetune_axes:
        lines.append(f"### {ax.axis}")
        lines.append(f"- **Goal:** {ax.goal}")
        lines.append("- **Dataset sources:**")
        for s in ax.dataset_sources:
            lines.append(f"  - {s}")
        lines.append("- **Evals:**")
        for e in ax.evals:
            lines.append(f"  - {e}")
        lines.append(f"- **Notes:** {ax.notes}")
        lines.append("")

    out_md.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo-root", required=True, help="Path to repo root")
    ap.add_argument("--out-dir", required=True, help="Output directory")
    ap.add_argument("--max-files", type=int, default=20000)
    ap.add_argument("--limit-bytes", type=int, default=DEFAULT_LIMIT_BYTES)
    args = ap.parse_args()

    repo_root = Path(args.repo_root).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    files = walk_repo(repo_root, max_files=args.max_files)
    file_sigs: list[FileSignals] = []
    for p in files:
        fs = signals_for_file(repo_root, p, limit_bytes=args.limit_bytes)
        if fs is not None:
            file_sigs.append(fs)

    fp = fingerprint_repo(repo_root, file_sigs)
    search = build_search_map(file_sigs)
    findings = build_refactor_findings(repo_root, file_sigs, search)
    axes = build_finetune_axes(search)

    totals = {
        "files_seen": len(files),
        "text_files_indexed": len(file_sigs),
        "prompt_signal_files": len(search.prompts),
        "tool_signal_files": len(search.tools),
        "telemetry_signal_files": len(search.telemetry),
        "rag_signal_files": len(search.rag),
        "eval_signal_files": len(search.eval),
        "ios_signal_files": len(search.ios),
    }

    plan = SymbiosisPlan(
        generated_at=datetime.utcnow().isoformat() + "Z",
        repo_root=str(repo_root),
        repo_fingerprint=fp,
        totals=totals,
        search_map=search,
        refactor_findings=findings,
        finetune_axes=axes,
    )

    # Write outputs
    (out_dir / "repo_index.json").write_text(
        json.dumps([asdict(fs) for fs in file_sigs], indent=2), encoding="utf-8"
    )
    (out_dir / "symbiosis_plan.json").write_text(
        json.dumps(asdict(plan), indent=2), encoding="utf-8"
    )
    write_markdown(plan, out_dir / "symbiosis_report.md")

    print(f"[symbiosis] indexed={len(file_sigs)} files (seen {len(files)})")
    print(f"[symbiosis] out_dir={out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
