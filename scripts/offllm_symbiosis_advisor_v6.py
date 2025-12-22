#!/usr/bin/env python3
"""
offLLM Symbiosis Advisor v6
==========================

Repo-wide "LLM-first" analysis tool that maps:
- Prompt surfaces / drift risk
- Tool orchestration + telemetry surfaces
- Retrieval/RAG & evaluation signals
- iOS / MLX / CoreML build/export surfaces

v6 upgrades
-----------
- Stable repo fingerprint (git-aware; otherwise content-hash based)
- Parallel file analysis with thread pool
- User config: .symbiosis.{json,yaml} + .symbiosis-ignore
- Optional git churn scoring (hotspots)
- Baseline comparison (diff vs previous run)
- SARIF export for CI integration
- Safer path handling (defensive relative paths)
- Richer prompt extraction (JSON chat, heredocs, templates) + line numbers
- Verbose + progress controls

Stdlib-only.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import dataclasses
import fnmatch
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple


DEFAULT_EXCLUDE_DIRS = {
    ".git", ".hg", ".svn",
    "node_modules", "dist", "build", ".next", ".turbo", ".cache",
    ".venv", "venv", "__pycache__",
    "Pods", "DerivedData",
    "runs",
    "reports",
    "unsloth_compiled_cache",
}

DEFAULT_IGNORE_GLOBS = [
    "reports/**",
    "runs/**",
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    "**/*.sarif",
    "**/*prompt-regression*.json",
    "**/*prompt-regression*",
    "**/*symbiosis*",
    "**/*symbiosis*report*",
]

TEXT_EXT_ALLOW = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".m", ".mm", ".swift", ".java", ".kt",
    ".c", ".cc", ".cpp", ".h", ".hpp",
    ".md", ".txt", ".rst",
    ".json", ".yml", ".yaml",
    ".toml", ".ini", ".cfg", ".env", ".properties",
    ".sh", ".bash", ".zsh",
    ".gradle",
    ".rb", ".go",
    ".hbs", ".mustache",
    ".plist",
    ".pbxproj",
}

ALWAYS_TEXT_NAMES = {
    "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "Podfile", "Gemfile", "Gemfile.lock",
    "AGENTS.md", "README.md", "LICENSE",
}

DEFAULT_PATTERN_STRINGS: Dict[str, List[str]] = {
    "prompt_markers": [
        r"\bsystem\s+prompt\b",
        r"\bdeveloper\s+message\b",
        r"\bprompt_template\b",
        r"\bprompt\b\s*[:=]",
        r"\bSYSTEM\b\s*[:=]",
        r"\bDEVELOPER\b\s*[:=]",
        r"\bYou are\b.*\bassistant\b",
        r"\bTools?\b.*\bavailable\b",
        r"\bjson\b.*\btool\b.*\bcall\b",
    ],
    "tool_markers": [
        r"\bToolRegistry\b",
        r"\btool_calls?\b",
        r"\bfunction\s+call\b",
        r"\bexecute_tool\b",
        r"\bcapabilit(y|ies)\b",
        r"\ballowlist\b",
        r"\bschema\b.*\bvalidate\b",
        r"\bJSON\s*Schema\b",
    ],
    "telemetry_markers": [
        r"\btelemetry\b",
        r"\bevent\b.*\bschema\b",
        r"\btrace\b",
        r"\blatenc(y|ies)\b",
        r"\bmetrics?\b",
        r"\bspan\b",
        r"\bOpenTelemetry\b",
        r"\blog\s*event\b",
    ],
    "rag_markers": [
        r"\bRAG\b",
        r"\bretriev(al|e)\b",
        r"\bembedding\b",
        r"\bvector\b",
        r"\bhnsw\b",
        r"\bchunk(ing|er)\b",
        r"\btop[- ]k\b",
        r"\brerank(er|ing)\b",
        r"\bcitation(s)?\b",
    ],
    "eval_markers": [
        r"\beval(uation)?\b",
        r"\bgolden\s+set\b",
        r"\bregression\b",
        r"\bbenchmark\b",
        r"\bassert\b",
        r"\btest(s)?\b",
        r"\bmetric(s)?\b",
    ],
    "ios_mlx_coreml_markers": [
        r"\bCoreML\b",
        r"\bcoremltools\b",
        r"\bmlx\b",
        r"\bMLX\b",
        r"\bTestFlight\b",
        r"\bApp\s*Store\s*Connect\b",
        r"\bxcodebuild\b",
        r"\bipa\b",
        r"\.mobileprovision\b",
        r"\bPodfile\b",
    ],
}

RE_JSON_CHAT_ROLE = re.compile(r'"role"\s*:\s*"(system|developer)"', re.IGNORECASE)
RE_HEREDOC_START = re.compile(r"<<-?\s*([\"']?)([A-Za-z0-9_]+)\1")
RE_TRIPLE_QUOTE = re.compile(r"([\"']{3})")
RE_BACKTICK_BLOCK = re.compile(r"```")


@dataclass(frozen=True)
class PromptSnippet:
    file: str
    start_line: int
    end_line: int
    kind: str
    preview: str
    sha256: str


@dataclass(frozen=True)
class FileSignals:
    file: str
    size: int
    prompt_score: int
    tool_score: int
    telemetry_score: int
    rag_score: int
    eval_score: int
    ios_score: int
    todos: int
    fixmes: int
    lang: str
    git_churn: int


@dataclass(frozen=True)
class DriftCluster:
    signature: str
    count: int
    files: List[str]
    sample_previews: List[str]


def eprint(*a: Any) -> None:
    print(*a, file=sys.stderr)


def mkdirp(p: Path) -> None:
    p.mkdir(parents=True, exist_ok=True)


def is_probably_text(b: bytes) -> bool:
    if b"\x00" in b:
        return False
    if not b:
        return True
    sample = b[:4096]
    bad = 0
    for ch in sample:
        if ch in (9, 10, 13):
            continue
        if ch < 32 or ch == 127:
            bad += 1
    return (bad / max(1, len(sample))) < 0.02


def safe_relpath(p: Path, root: Path) -> Optional[str]:
    try:
        rp = p.resolve()
        rr = root.resolve()
        rel = rp.relative_to(rr)
        if ".." in rel.parts:
            return None
        return rel.as_posix()
    except Exception:
        return None


def read_text_limited(path: Path, max_bytes: int) -> Optional[str]:
    try:
        st = path.stat()
        if st.st_size > max_bytes:
            with path.open("rb") as f:
                b = f.read(min(max_bytes, 262144))
            if not is_probably_text(b):
                return None
            return b.decode("utf-8", errors="replace")
        with path.open("rb") as f:
            b = f.read()
        if not is_probably_text(b):
            return None
        return b.decode("utf-8", errors="replace")
    except Exception:
        return None


def compile_patterns(pats: Sequence[str]) -> List[re.Pattern[str]]:
    out: List[re.Pattern[str]] = []
    for s in pats:
        try:
            out.append(re.compile(s, re.IGNORECASE | re.MULTILINE))
        except re.error:
            continue
    return out


def score_text(text: str, patterns: List[re.Pattern[str]]) -> int:
    if not text:
        return 0
    score = 0
    for rx in patterns:
        score += len(rx.findall(text))
    return score


def count_todos_fixmes(text: str) -> Tuple[int, int]:
    if not text:
        return (0, 0)
    todos = len(re.findall(r"\bTODO\b", text))
    fixmes = len(re.findall(r"\bFIXME\b", text))
    return (todos, fixmes)


def infer_lang(p: Path) -> str:
    ext = p.suffix.lower()
    if ext == ".py":
        return "python"
    if ext in (".js", ".jsx"):
        return "javascript"
    if ext in (".ts", ".tsx"):
        return "typescript"
    if ext in (".m", ".mm"):
        return "objc"
    if ext == ".swift":
        return "swift"
    if ext == ".java":
        return "java"
    if ext == ".kt":
        return "kotlin"
    if ext in (".sh", ".bash", ".zsh"):
        return "shell"
    if ext in (".md", ".rst", ".txt"):
        return "docs"
    if ext in (".json", ".yml", ".yaml", ".toml", ".ini", ".cfg"):
        return "config"
    return ext.lstrip(".") or "unknown"


def _parse_minimal_yaml(text: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    cur_key: Optional[str] = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if re.match(r"^[A-Za-z0-9_\-]+\s*:", line):
            k, v = line.split(":", 1)
            k = k.strip()
            v = v.strip()
            if v == "":
                out[k] = []
                cur_key = k
            else:
                if v.lower() in ("true", "false"):
                    out[k] = (v.lower() == "true")
                else:
                    try:
                        out[k] = int(v)
                    except ValueError:
                        out[k] = v.strip('"').strip("'")
                cur_key = None
            continue
        if line.startswith("-") and cur_key:
            item = line[1:].strip()
            if isinstance(out.get(cur_key), list):
                out[cur_key].append(item)
    return out


def load_user_config(repo_root: Path, explicit: Optional[Path]) -> Dict[str, Any]:
    candidates: List[Path] = []
    if explicit:
        candidates.append(explicit)
    else:
        candidates.extend([
            repo_root / ".symbiosis.json",
            repo_root / ".symbiosis.yaml",
            repo_root / ".symbiosis.yml",
        ])
    cfg: Dict[str, Any] = {}
    for p in candidates:
        if not p.exists():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
            if p.suffix.lower() == ".json":
                cfg = json.loads(text)
            else:
                cfg = _parse_minimal_yaml(text)
            cfg["_config_path"] = p.as_posix()
            break
        except Exception as ex:
            cfg = {"_config_error": f"Failed to read {p}: {ex}"}
            break
    ign = repo_root / ".symbiosis-ignore"
    if ign.exists():
        globs: List[str] = []
        for raw in ign.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            globs.append(line)
        cfg["ignore_globs"] = globs
    return cfg


def cfg_list(cfg: Dict[str, Any], key: str, default: List[str]) -> List[str]:
    v = cfg.get(key, default)
    if isinstance(v, list):
        return [str(x) for x in v]
    if isinstance(v, str):
        return [v]
    return default


def cfg_bool(cfg: Dict[str, Any], key: str, default: bool) -> bool:
    v = cfg.get(key, default)
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.lower() in ("1", "true", "yes", "y", "on")
    return default


def cfg_int(cfg: Dict[str, Any], key: str, default: int) -> int:
    v = cfg.get(key, default)
    try:
        return int(v)
    except Exception:
        return default


def merge_ignore_globs(defaults: List[str], overrides: List[str]) -> List[str]:
    out = []
    seen = set()
    for item in defaults + overrides:
        item = str(item)
        if item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _run_git(repo_root: Path, args: List[str]) -> Optional[str]:
    try:
        r = subprocess.run(
            ["git"] + args,
            cwd=str(repo_root),
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            check=True,
        )
        return r.stdout.strip()
    except Exception:
        return None


def git_head_and_dirty(repo_root: Path) -> Optional[str]:
    head = _run_git(repo_root, ["rev-parse", "HEAD"])
    if not head:
        return None
    dirty = _run_git(repo_root, ["status", "--porcelain"])
    dirty_flag = "dirty" if (dirty and dirty.strip()) else "clean"
    return f"{head}:{dirty_flag}"


def git_churn(repo_root: Path, relpath: str, max_commits: int = 2000) -> int:
    out = _run_git(repo_root, ["log", f"-n{max_commits}", "--oneline", "--", relpath])
    if not out:
        return 0
    return len([ln for ln in out.splitlines() if ln.strip()])


def file_content_hash(p: Path, max_bytes: int) -> Optional[str]:
    txt = read_text_limited(p, max_bytes=max_bytes)
    if txt is None:
        return None
    h = hashlib.sha256()
    h.update(txt.encode("utf-8", errors="ignore"))
    return h.hexdigest()


def repo_fingerprint(repo_root: Path, files: Sequence[Path], max_bytes: int, use_git: bool) -> str:
    if use_git:
        g = git_head_and_dirty(repo_root)
        if g:
            return "git:" + hashlib.sha1(g.encode("utf-8", errors="ignore")).hexdigest()
    h = hashlib.sha1()
    for p in sorted(files, key=lambda x: x.as_posix()):
        rel = safe_relpath(p, repo_root)
        if not rel:
            continue
        h.update(rel.encode("utf-8", errors="ignore"))
        try:
            st = p.stat()
        except FileNotFoundError:
            continue
        ch = file_content_hash(p, max_bytes=max_bytes)
        if ch:
            h.update(ch.encode("ascii", errors="ignore"))
        else:
            h.update(str(st.st_size).encode("ascii", errors="ignore"))
    return h.hexdigest()


def _sha256(s: str) -> str:
    h = hashlib.sha256()
    h.update(s.encode("utf-8", errors="ignore"))
    return h.hexdigest()


def extract_prompt_snippets(rel: str, text: str, max_preview_chars: int = 240) -> List[PromptSnippet]:
    snippets: List[PromptSnippet] = []
    lines = text.splitlines()
    n = len(lines)

    # JSON chat extraction
    if RE_JSON_CHAT_ROLE.search(text):
        try:
            obj = json.loads(text)

            def walk(x: Any) -> Iterator[Tuple[str, str]]:
                if isinstance(x, dict):
                    role = x.get("role")
                    content = x.get("content")
                    if isinstance(role, str) and isinstance(content, str):
                        if role.lower() in ("system", "developer"):
                            yield (role.lower(), content)
                    for v in x.values():
                        yield from walk(v)
                elif isinstance(x, list):
                    for it in x:
                        yield from walk(it)

            for role, content in walk(obj):
                preview = content.strip().replace("\n", " ")[:max_preview_chars]
                snippets.append(PromptSnippet(
                    file=rel,
                    start_line=1,
                    end_line=max(1, min(n, 5)),
                    kind=f"json:{role}",
                    preview=preview,
                    sha256=_sha256(content),
                ))
        except Exception:
            pass

    # HEREDOCs
    i = 0
    while i < n:
        m = RE_HEREDOC_START.search(lines[i])
        if m:
            tag = m.group(2)
            start = i
            i += 1
            block: List[str] = []
            while i < n and lines[i].strip() != tag:
                block.append(lines[i])
                i += 1
            end = i if i < n else n - 1
            content = "\n".join(block).strip()
            if content and re.search(r"\b(system|developer)\b.*\bprompt\b", content, re.IGNORECASE):
                preview = content.replace("\n", " ")[:max_preview_chars]
                snippets.append(PromptSnippet(rel, start + 1, end + 1, f"heredoc:{tag}", preview, _sha256(content)))
            i += 1
            continue
        i += 1

    # Triple-quoted blocks
    i = 0
    while i < n:
        m = RE_TRIPLE_QUOTE.search(lines[i])
        if not m:
            i += 1
            continue
        delim = m.group(1)
        start = i
        rest = lines[i].split(delim, 1)[1]
        block: List[str] = [rest] if rest.strip() else []
        i += 1
        while i < n and delim not in lines[i]:
            block.append(lines[i])
            i += 1
        if i < n:
            before, _after = lines[i].split(delim, 1)
            block.append(before)
        end = i if i < n else n - 1
        content = "\n".join(block).strip()
        if content and re.search(r"\b(system|developer)\b", content, re.IGNORECASE) and re.search(r"\bassistant\b", content, re.IGNORECASE):
            preview = content.replace("\n", " ")[:max_preview_chars]
            snippets.append(PromptSnippet(rel, start + 1, end + 1, "triple-quote", preview, _sha256(content)))
        i += 1

    # Markdown fenced blocks
    fence_idxs = [idx for idx, ln in enumerate(lines) if RE_BACKTICK_BLOCK.match(ln.strip())]
    for a, b in zip(fence_idxs[0::2], fence_idxs[1::2]):
        block = "\n".join(lines[a+1:b]).strip()
        if not block:
            continue
        if re.search(r"\b(system|developer)\b", block, re.IGNORECASE) and re.search(r"\bprompt\b", block, re.IGNORECASE):
            preview = block.replace("\n", " ")[:max_preview_chars]
            snippets.append(PromptSnippet(rel, a + 1, b + 1, "fenced", preview, _sha256(block)))

    # Inline marker windows with line numbers
    for idx, ln in enumerate(lines):
        if re.search(r"\bsystem\s+prompt\b|\bdeveloper\s+message\b", ln, re.IGNORECASE):
            start = max(0, idx - 2)
            end = min(n, idx + 6)
            block = "\n".join(lines[start:end]).strip()
            if block:
                preview = block.replace("\n", " ")[:max_preview_chars]
                snippets.append(PromptSnippet(rel, start + 1, end, "marker-window", preview, _sha256(block)))

    # de-dup
    seen = set()
    uniq: List[PromptSnippet] = []
    for s in snippets:
        k = (s.kind, s.sha256)
        if k in seen:
            continue
        seen.add(k)
        uniq.append(s)
    return uniq


def analyze_one_file(
    p: Path,
    repo_root: Path,
    max_bytes: int,
    patterns: Dict[str, List[re.Pattern[str]]],
    include_git_churn: bool,
) -> Tuple[Optional[FileSignals], List[PromptSnippet]]:
    rel = safe_relpath(p, repo_root)
    if not rel:
        return (None, [])
    try:
        st = p.stat()
        size = int(st.st_size)
    except FileNotFoundError:
        return (None, [])
    text = read_text_limited(p, max_bytes=max_bytes)
    if text is None:
        return (FileSignals(rel, size, 0, 0, 0, 0, 0, 0, 0, 0, infer_lang(p), 0), [])
    sig = FileSignals(
        file=rel,
        size=size,
        prompt_score=score_text(text, patterns["prompt"]),
        tool_score=score_text(text, patterns["tool"]),
        telemetry_score=score_text(text, patterns["telemetry"]),
        rag_score=score_text(text, patterns["rag"]),
        eval_score=score_text(text, patterns["eval"]),
        ios_score=score_text(text, patterns["ios"]),
        todos=count_todos_fixmes(text)[0],
        fixmes=count_todos_fixmes(text)[1],
        lang=infer_lang(p),
        git_churn=(git_churn(repo_root, rel) if include_git_churn else 0),
    )
    snips: List[PromptSnippet] = []
    if sig.prompt_score > 0 or RE_JSON_CHAT_ROLE.search(text):
        snips = extract_prompt_snippets(rel, text)
    return (sig, snips)


def should_index_path(rel: str, exclude_dirs: set[str], ignore_globs: List[str]) -> bool:
    parts = rel.split("/")
    if any(part in exclude_dirs for part in parts):
        return False
    for g in ignore_globs:
        if fnmatch.fnmatch(rel, g) or fnmatch.fnmatch("/" + rel, g):
            return False
    return True


def iter_candidate_files(
    repo_root: Path,
    exclude_dirs: set[str],
    ignore_globs: List[str],
    include_generated: bool,
) -> Tuple[List[Path], Dict[str, int]]:
    out: List[Path] = []
    stats = {
        "files_seen": 0,
        "files_included": 0,
        "files_excluded": 0,
        "dirs_pruned": 0,
    }
    for root, dirs, files in os.walk(repo_root):
        pruned = []
        for d in list(dirs):
            if d in exclude_dirs and not include_generated:
                pruned.append(d)
        for d in pruned:
            dirs.remove(d)
        stats["dirs_pruned"] += len(pruned)

        for fn in files:
            stats["files_seen"] += 1
            p = Path(root) / fn
            rel = safe_relpath(p, repo_root)
            if not rel:
                stats["files_excluded"] += 1
                continue
            if not should_index_path(
                rel, exclude_dirs if not include_generated else set(), ignore_globs
            ):
                stats["files_excluded"] += 1
                continue
            ext = p.suffix.lower()
            included = False
            if ext in TEXT_EXT_ALLOW or fn in ALWAYS_TEXT_NAMES:
                included = True
            if included:
                out.append(p)
                stats["files_included"] += 1
            else:
                stats["files_excluded"] += 1
    return out, stats


def token_signature(snippet: str, max_tokens: int = 64) -> str:
    toks = re.findall(r"[A-Za-z_][A-Za-z0-9_]+", snippet.lower())
    if not toks:
        return "empty"
    c = Counter(toks)
    top = [t for t, _ in c.most_common(max_tokens)]
    h = hashlib.sha256()
    h.update((" ".join(top)).encode("utf-8", errors="ignore"))
    return h.hexdigest()[:16]


def cluster_prompts(snippets: List[PromptSnippet]) -> List[DriftCluster]:
    by_sig: Dict[str, List[PromptSnippet]] = defaultdict(list)
    for s in snippets:
        by_sig[token_signature(s.preview)].append(s)
    clusters: List[DriftCluster] = []
    for sig, items in by_sig.items():
        files = sorted({it.file for it in items})
        previews = [f"{it.kind}@{it.start_line}-{it.end_line}: {it.preview}" for it in items[:3]]
        clusters.append(DriftCluster(sig, len(items), files, previews))
    clusters.sort(key=lambda c: (-c.count, len(c.files), c.signature))
    return clusters


def top_files_by(signals: List[FileSignals], key: str, n: int = 25) -> List[str]:
    idx = {
        "prompt": lambda s: s.prompt_score,
        "tool": lambda s: s.tool_score,
        "telemetry": lambda s: s.telemetry_score,
        "rag": lambda s: s.rag_score,
        "eval": lambda s: s.eval_score,
        "ios": lambda s: s.ios_score,
        "todos": lambda s: s.todos + s.fixmes,
        "churn": lambda s: s.git_churn,
    }[key]
    xs = [s for s in signals if idx(s) > 0]
    xs.sort(key=lambda s: (idx(s), s.size), reverse=True)
    return [s.file for s in xs[:n]]


def build_actions(report: Dict[str, Any]) -> List[Dict[str, Any]]:
    actions: List[Dict[str, Any]] = []
    totals = report.get("totals", {})
    if totals.get("prompt_signal_files", 0) >= 10:
        actions.append({
            "priority": "high",
            "title": "Unify prompt surfaces into versioned templates",
            "why": "Prompt drift breaks alignment between runtime, fine-tuning, and eval.",
            "next_steps": [
                "Create prompts/v1/*.json and a registry.json (id+version).",
                "Load prompts at runtime by id+version; log prompt_id+version into telemetry.",
                "Add CI lint: fail if new system prompts are added outside registry.",
            ],
            "evidence": report.get("where_to_search", {}).get("prompts", [])[:20],
        })
    if totals.get("telemetry_signal_files", 0) >= 5:
        actions.append({
            "priority": "high",
            "title": "Standardise telemetry schema and redaction",
            "why": "Telemetry is the bridge between what the app did and what the model should learn.",
            "next_steps": [
                "Define an event schema for model interactions.",
                "Centralise PII redaction (emails, tokens, keys).",
                "Implement telemetry→SFT and telemetry→retrieval pairs transforms.",
            ],
            "evidence": report.get("where_to_search", {}).get("telemetry", [])[:20],
        })
    if totals.get("rag_signal_files", 0) >= 5:
        actions.append({
            "priority": "med",
            "title": "Isolate retrieval + chunking into a single library surface",
            "why": "Stable chunking/embedding settings prevent offline vs runtime mismatch.",
            "next_steps": [
                "Extract chunking rules into one module with golden tests.",
                "Log retrieval traces into telemetry.",
                "Train embeddings/LLM2Vec with the same chunk distribution used at runtime.",
            ],
            "evidence": report.get("where_to_search", {}).get("retrieval_rag", [])[:20],
        })
    if totals.get("eval_signal_files", 0) >= 5:
        actions.append({
            "priority": "high",
            "title": "Make evaluation first-class (golden set + regression gates)",
            "why": "Fine-tuning without a regression gate is just vibe-training.",
            "next_steps": [
                "Create a golden eval suite: tool parsing, JSON validity, groundedness/citations, refusal correctness.",
                "Add an offline eval CLI and a CI job that blocks regressions.",
                "Version eval cases alongside prompt templates.",
            ],
            "evidence": report.get("where_to_search", {}).get("evaluation", [])[:20],
        })
    if totals.get("tool_signal_files", 0) >= 5:
        actions.append({
            "priority": "med",
            "title": "Harden tool-calling boundaries and injection resistance",
            "why": "Tool-calling is the highest-risk surface; harden and train for safe behaviour.",
            "next_steps": [
                "Validate tool args against JSON schema before execution.",
                "Capability-based allowlists.",
                "Add red-team eval set: injection, schema smuggling, exfil attempts.",
            ],
            "evidence": report.get("where_to_search", {}).get("tools_orchestration", [])[:20],
        })
    return actions


def export_sarif(report: Dict[str, Any], out_path: Path) -> None:
    tool = {"driver": {"name": "offLLM Symbiosis Advisor", "rules": [
        {"id": "prompt-drift", "name": "Prompt drift surface"},
        {"id": "hotspot", "name": "High-signal hotspot"},
    ]}}
    results: List[Dict[str, Any]] = []
    for c in report.get("prompt_drift_clusters", [])[:25]:
        for f in c.get("files", [])[:10]:
            results.append({
                "ruleId": "prompt-drift",
                "level": "warning",
                "message": {"text": f"Prompt drift cluster {c.get('signature')} appears in {c.get('count')} snippets."},
                "locations": [{"physicalLocation": {"artifactLocation": {"uri": f}}}],
            })
    for f in report.get("where_to_search", {}).get("prompts", [])[:50]:
        results.append({
            "ruleId": "hotspot",
            "level": "note",
            "message": {"text": "High prompt-signal file (review for prompt drift / registry compliance)."},
            "locations": [{"physicalLocation": {"artifactLocation": {"uri": f}}}],
        })
    sarif = {"$schema": "https://json.schemastore.org/sarif-2.1.0.json", "version": "2.1.0", "runs": [{"tool": tool, "results": results}]}
    out_path.write_text(json.dumps(sarif, indent=2), encoding="utf-8")


def compare_with_baseline(current: Dict[str, Any], baseline_path: Path) -> Dict[str, Any]:
    if not baseline_path.exists():
        return {"baseline_found": False, "summary": "No baseline file found.", "diff": {}}
    try:
        baseline = json.loads(baseline_path.read_text(encoding="utf-8", errors="replace"))
    except Exception as ex:
        return {"baseline_found": True, "summary": f"Failed to read baseline: {ex}", "diff": {}}
    cur_tot = current.get("totals", {})
    base_tot = baseline.get("totals", {})
    keys = sorted(set(cur_tot.keys()) | set(base_tot.keys()))
    diff_tot = {}
    for k in keys:
        try:
            diff_tot[k] = int(cur_tot.get(k, 0)) - int(base_tot.get(k, 0))
        except Exception:
            diff_tot[k] = None
    cur_pf = set(current.get("where_to_search", {}).get("prompts", []))
    base_pf = set(baseline.get("where_to_search", {}).get("prompts", []))
    new_prompt_files = sorted(cur_pf - base_pf)[:200]
    cur_sig = {c.get("signature") for c in current.get("prompt_drift_clusters", []) if c.get("signature")}
    base_sig = {c.get("signature") for c in baseline.get("prompt_drift_clusters", []) if c.get("signature")}
    new_clusters = sorted(cur_sig - base_sig)[:200]
    return {"baseline_found": True, "summary": "Computed baseline diff.", "diff": {"totals_delta": diff_tot, "new_prompt_files": new_prompt_files, "new_drift_clusters": new_clusters}}


def render_markdown(report: Dict[str, Any]) -> str:
    lines: List[str] = []
    lines.append("# offLLM Symbiosis Deep Report (v6)\n")
    lines.append(f"- Generated: **{report.get('generated_at','')}**")
    lines.append(f"- Repo root: `{report.get('repo_root','')}`")
    lines.append(f"- Repo fingerprint: `{report.get('repo_fingerprint','')}`")
    if report.get("config_path"):
        lines.append(f"- Config: `{report.get('config_path')}`")
    if report.get("baseline", {}).get("baseline_found"):
        lines.append(f"- Baseline: `{report.get('baseline', {}).get('path','')}`")
    lines.append("\n## Totals")
    for k, v in report.get("totals", {}).items():
        lines.append(f"- **{k}**: {v}")
    if report.get("baseline", {}).get("baseline_found"):
        lines.append("\n## Baseline diff")
        bd = report.get("baseline", {}).get("diff", {})
        td = bd.get("totals_delta", {})
        if td:
            lines.append("\n### Totals delta")
            for k, v in td.items():
                lines.append(f"- **{k}**: {v}")
        npf = bd.get("new_prompt_files", [])
        if npf:
            lines.append("\n### New prompt-signal files")
            for f in npf[:25]:
                lines.append(f"- `{f}`")
        ncl = bd.get("new_drift_clusters", [])
        if ncl:
            lines.append("\n### New drift clusters")
            for s in ncl[:25]:
                lines.append(f"- `{s}`")
    lines.append("\n## Where to search")
    for section, arr in report.get("where_to_search", {}).items():
        lines.append(f"\n### {section.replace('_',' ').title()}")
        for f in arr[:25]:
            lines.append(f"- `{f}`")
        if len(arr) > 25:
            lines.append(f"- … and {len(arr)-25} more")
    lines.append("\n## Prompt drift clusters")
    for c in report.get("prompt_drift_clusters", [])[:15]:
        lines.append(f"\n### Cluster `{c.get('signature')}` ({c.get('count')} snippets, {len(c.get('files',[]))} files)")
        for p in c.get("sample_previews", [])[:3]:
            lines.append(f"- {p}")
        for f in c.get("files", [])[:10]:
            lines.append(f"- `{f}`")
        if len(c.get("files", [])) > 10:
            lines.append(f"- … and {len(c.get('files',[]))-10} more")
    lines.append("\n## Action items")
    for a in report.get("actions", []):
        lines.append(f"\n### {a.get('title')} ({a.get('priority')})")
        lines.append(f"**Why:** {a.get('why')}")
        lines.append("\n**Next steps:**")
        for s in a.get("next_steps", []):
            lines.append(f"- {s}")
        ev = a.get("evidence", [])
        if ev:
            lines.append("\n**Where:**")
            for f in ev[:15]:
                lines.append(f"- `{f}`")
    lines.append("\n## Prompt snippet index (sample)")
    for s in report.get("prompt_snippets", [])[:30]:
        lines.append(f"- `{s.get('file')}`:{s.get('start_line')}-{s.get('end_line')} [{s.get('kind')}] {s.get('preview')}")
    if len(report.get("prompt_snippets", [])) > 30:
        lines.append(f"- … and {len(report.get('prompt_snippets',[]))-30} more")
    lines.append("")
    return "\n".join(lines)


def analyze_repo(args: argparse.Namespace) -> Dict[str, Any]:
    repo_root = Path(args.repo_root).resolve()
    out_dir = Path(args.out_dir).resolve()
    mkdirp(out_dir)

    cfg = load_user_config(repo_root, Path(args.config).resolve() if args.config else None)
    exclude_dirs = set(cfg_list(cfg, "exclude_dirs", sorted(DEFAULT_EXCLUDE_DIRS)))
    ignore_globs = merge_ignore_globs(
        DEFAULT_IGNORE_GLOBS,
        cfg_list(cfg, "ignore_globs", []),
    )
    include_generated = bool(args.include_generated or cfg_bool(cfg, "include_generated", False))
    use_git = bool(args.git or cfg_bool(cfg, "use_git", True))
    include_git_churn = bool(args.git_churn or cfg_bool(cfg, "include_git_churn", False))
    max_bytes = int(args.max_file_size or cfg_int(cfg, "max_file_size", 2_000_000))
    workers = int(args.workers or cfg_int(cfg, "workers", max(4, (os.cpu_count() or 4) * 2)))

    patt_cfg = cfg.get("patterns", {}) if isinstance(cfg.get("patterns"), dict) else {}

    def get_patts(fam: str) -> List[str]:
        base = DEFAULT_PATTERN_STRINGS.get(fam, [])
        override = patt_cfg.get(fam, None)
        if isinstance(override, list):
            return base + [str(x) for x in override]
        if isinstance(override, str):
            return base + [override]
        return base

    patterns = {
        "prompt": compile_patterns(get_patts("prompt_markers")),
        "tool": compile_patterns(get_patts("tool_markers")),
        "telemetry": compile_patterns(get_patts("telemetry_markers")),
        "rag": compile_patterns(get_patts("rag_markers")),
        "eval": compile_patterns(get_patts("eval_markers")),
        "ios": compile_patterns(get_patts("ios_mlx_coreml_markers")),
    }

    t0 = time.time()
    paths, index_stats = iter_candidate_files(
        repo_root,
        exclude_dirs,
        ignore_globs,
        include_generated=include_generated,
    )
    repo_fp = repo_fingerprint(repo_root, paths, max_bytes=max_bytes, use_git=use_git)
    generated_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    signals: List[FileSignals] = []
    snippets: List[PromptSnippet] = []

    total = len(paths)
    done = 0

    def progress_ping() -> None:
        if not args.progress or total == 0:
            return
        pct = (done / total) * 100.0
        eprint(f"[symbiosis] {done}/{total} files ({pct:.1f}%)")

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(analyze_one_file, p, repo_root, max_bytes, patterns, include_git_churn) for p in paths]
        for fut in concurrent.futures.as_completed(futs):
            sig, sn = fut.result()
            if sig is not None:
                signals.append(sig)
            snippets.extend(sn)
            done += 1
            if args.progress and (done % max(1, total // 20) == 0):
                progress_ping()

    def count_files(pred) -> int:
        return sum(1 for s in signals if pred(s))

    totals = {
        "files_seen": total,
        "text_files_indexed": len(signals),
        "prompt_signal_files": count_files(lambda s: s.prompt_score > 0),
        "tool_signal_files": count_files(lambda s: s.tool_score > 0),
        "telemetry_signal_files": count_files(lambda s: s.telemetry_score > 0),
        "rag_signal_files": count_files(lambda s: s.rag_score > 0),
        "eval_signal_files": count_files(lambda s: s.eval_score > 0),
        "ios_signal_files": count_files(lambda s: s.ios_score > 0),
    }

    where = {
        "prompts": top_files_by(signals, "prompt", n=35),
        "tools_orchestration": top_files_by(signals, "tool", n=35),
        "telemetry": top_files_by(signals, "telemetry", n=35),
        "retrieval_rag": top_files_by(signals, "rag", n=35),
        "evaluation": top_files_by(signals, "eval", n=35),
        "ios_mlx_coreml": top_files_by(signals, "ios", n=35),
        "todos_fixmes": top_files_by(signals, "todos", n=35),
        "hot_churn": top_files_by(signals, "churn", n=35) if include_git_churn else [],
    }

    clusters = cluster_prompts(snippets)

    report: Dict[str, Any] = {
        "version": "v6",
        "generated_at": generated_at,
        "repo_root": repo_root.as_posix(),
        "repo_fingerprint": repo_fp,
        "config_path": cfg.get("_config_path"),
        "indexing_summary": {
            "files_scanned": int(index_stats.get("files_seen", 0)),
            "files_indexed": int(index_stats.get("files_included", len(paths))),
            "files_excluded": int(index_stats.get("files_excluded", 0)),
            "excluded_patterns": sorted(
                set(ignore_globs)
                | {f"{name}/**" for name in exclude_dirs}
            ),
        },
        "indexing": {
            "exclude_dirs": sorted(exclude_dirs),
            "ignore_globs": ignore_globs,
            "files_included": index_stats.get("files_included", len(paths)),
            "files_excluded": index_stats.get("files_excluded", 0),
        },
        "totals": totals,
        "where_to_search": where,
        "prompt_drift_clusters": [dataclasses.asdict(c) for c in clusters],
        "prompt_snippets": [dataclasses.asdict(s) for s in snippets],
        "elapsed_seconds": round(time.time() - t0, 3),
        "params": {
            "include_generated": include_generated,
            "max_file_size": max_bytes,
            "workers": workers,
            "use_git": use_git,
            "include_git_churn": include_git_churn,
        },
    }

    report["actions"] = build_actions(report)

    if args.baseline:
        bp = Path(args.baseline).resolve()
        report["baseline"] = {"path": bp.as_posix(), **compare_with_baseline(report, bp)}

    json_path = out_dir / "symbiosis_deep_report.json"
    md_path = out_dir / "symbiosis_deep_report.md"
    json_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")

    if args.sarif:
        export_sarif(report, out_dir / "symbiosis_deep_report.sarif.json")

    return report


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="offLLM Symbiosis Advisor v6 (stdlib-only)")
    p.add_argument("--repo-root", default=".", help="Repository root")
    p.add_argument("--repo", dest="repo_root", help="Repository root (alias)")
    p.add_argument("--out-dir", default="reports/symbiosis_v6", help="Output directory")
    p.add_argument("--include-generated", action="store_true", help="Include typically generated dirs (runs, cache, etc.)")
    p.add_argument("--max-file-size", type=int, default=2_000_000, help="Max bytes to read per file")
    p.add_argument("--workers", type=int, default=0, help="Thread workers (0 => auto)")
    p.add_argument("--config", default="", help="Explicit config path (.symbiosis.json/.yaml)")
    p.add_argument("--git", action="store_true", help="Prefer git-based fingerprinting if available")
    p.add_argument("--git-churn", action="store_true", help="Compute git churn per file (slower)")
    p.add_argument("--baseline", default="", help="Path to baseline JSON report to diff against")
    p.add_argument("--sarif", action="store_true", help="Emit SARIF report for CI/CD ingestion")
    p.add_argument("--progress", action="store_true", help="Print progress while scanning")
    p.add_argument("--verbose", action="store_true", help="Verbose logging")
    return p


def main() -> int:
    args = build_arg_parser().parse_args()
    report = analyze_repo(args)
    print(json.dumps({
        "ok": True,
        "version": report.get("version"),
        "generated_at": report.get("generated_at"),
        "repo_fingerprint": report.get("repo_fingerprint"),
        "out_dir": Path(args.out_dir).resolve().as_posix(),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
