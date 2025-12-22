#!/usr/bin/env python3
"""
offLLM Symbiosis Conductor (v1)
===============================

Purpose
-------
Turn a Symbiosis Advisor "deep report" into an actionable, repo-aware plan that:
  1) tells you *exactly where to search* for prompts / tools / telemetry / RAG / eval / iOS
  2) prioritizes refactors (hotspots + git churn + SARIF findings)
  3) produces concrete fine-tuning manifests (telemetry→SFT, retrieval pairs, tool-call robustness)
  4) supports baseline comparison (regression / drift)

This script is intentionally stdlib-only so it can run in CI and on fresh machines.

Inputs
------
- symbiosis_deep_report.json (v6 format)
- optional symbiosis_deep_report.sarif.json
- optional baseline report (same format)
- optional config (.offllm-symbiosis.toml / .json) for overrides

Outputs
-------
- symbiosis_conductor_report.md
- symbiosis_conductor_report.json
- fine_tune_manifest.json
- optional SARIF "summary" (does not modify the provided SARIF)

Typical usage
-------------
python scripts/offllm_symbiosis_conductor_v1.py \
  --repo /home/ales27pm/offLLM-1 \
  --report reports/symbiosis_v6/symbiosis_deep_report.json \
  --sarif reports/symbiosis_v6/symbiosis_deep_report.sarif.json \
  --baseline reports/symbiosis_v6/symbiosis_deep_report.prev.json \
  --out reports/symbiosis_conductor

Design notes
------------
- Uses git when available to compute stable fingerprints + churn (recent commit count per file).
- Produces deterministic ordering for stable diffs in PRs.
- Keeps language neutral; your runtime can enforce "voice" via versioned prompt templates.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as _dt
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    import tomllib  # py>=3.11
except Exception:  # pragma: no cover
    tomllib = None  # type: ignore

# ----------------------------
# Models
# ----------------------------

@dataclass(frozen=True)
class SarifFinding:
    rule_id: str
    level: str
    message: str
    uri: str
    start_line: Optional[int] = None


@dataclass(frozen=True)
class Hotspot:
    path: str
    score: float
    reasons: List[str]
    churn_commits: int


# ----------------------------
# Small utilities
# ----------------------------

def _utc_now() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _read_json(p: Path) -> Dict[str, Any]:
    with p.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_text(p: Path, s: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s, encoding="utf-8")


def _write_json(p: Path, obj: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def _sh(cmd: List[str], cwd: Optional[Path] = None, timeout_s: int = 30) -> Tuple[int, str, str]:
    try:
        r = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
        return r.returncode, r.stdout, r.stderr
    except Exception as e:
        return 127, "", str(e)


def _is_git_repo(repo: Path) -> bool:
    rc, out, _ = _sh(["git", "rev-parse", "--is-inside-work-tree"], cwd=repo)
    return rc == 0 and out.strip() == "true"


def _git_head(repo: Path) -> Optional[str]:
    rc, out, _ = _sh(["git", "rev-parse", "HEAD"], cwd=repo)
    if rc != 0:
        return None
    h = out.strip()
    return h if re.fullmatch(r"[0-9a-f]{7,40}", h) else None


def _git_branch(repo: Path) -> Optional[str]:
    rc, out, _ = _sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo)
    if rc != 0:
        return None
    b = out.strip()
    return b if b else None


def _git_recent_commit_count(repo: Path, rel_path: str, max_count: int = 200) -> int:
    # Count commits touching file (bounded for speed).
    # Using --max-count still returns <=max_count lines.
    rc, out, _ = _sh(["git", "log", f"--max-count={max_count}", "--oneline", "--", rel_path], cwd=repo, timeout_s=60)
    if rc != 0:
        return 0
    out = out.strip()
    if not out:
        return 0
    return len(out.splitlines())


def _stable_repo_fingerprint(repo: Path) -> str:
    """
    Prefer git HEAD hash as stable fingerprint. Fall back to a content-based hash
    of a small deterministic subset (to avoid O(N) on huge repos).

    This is intentionally stable: we do NOT include mtimes.
    """
    if _is_git_repo(repo):
        head = _git_head(repo)
        if head:
            return f"git:{head}"
    # fallback: hash directory listing + sizes + content hash of first 256 KB per file
    h = hashlib.sha256()
    # Deterministic walk: only text-ish source files; skip giant binaries.
    ex_dirs = {".git", "node_modules", "Pods", "DerivedData", "build", "dist", ".next", ".expo", "__pycache__"}
    ex_ext = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip", ".gz", ".7z", ".pdf", ".mp4", ".mov", ".dylib", ".so", ".a"}
    max_files = 250  # keep bounded
    max_bytes_per_file = 256_000

    paths: List[Path] = []
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in ex_dirs]
        for fn in files:
            p = Path(root) / fn
            if p.suffix.lower() in ex_ext:
                continue
            paths.append(p)
    paths = sorted(paths, key=lambda p: str(p))[:max_files]
    for p in paths:
        try:
            st = p.stat()
        except FileNotFoundError:
            continue
        rel = str(p.relative_to(repo)).encode("utf-8", errors="ignore")
        h.update(rel)
        h.update(str(st.st_size).encode("ascii", errors="ignore"))
        try:
            with p.open("rb") as f:
                chunk = f.read(max_bytes_per_file)
            h.update(hashlib.sha256(chunk).digest())
        except Exception:
            continue
    return "fs:" + h.hexdigest()


def _safe_rel(p: Path, root: Path) -> str:
    """Ensure path is within repo root."""
    try:
        rel = p.resolve().relative_to(root.resolve())
        # relative_to already rejects path traversal outside root
        return rel.as_posix()
    except Exception:
        raise ValueError(f"Path {p} is outside repo root {root}")


# ----------------------------
# Config
# ----------------------------

@dataclass(frozen=True)
class ConductorConfig:
    max_hotspots: int = 30
    churn_max_count: int = 200
    rg_bin: str = "rg"
    include_rg_commands: bool = True
    include_git_churn: bool = True
    extra_search_patterns: Dict[str, List[str]] = dataclasses.field(default_factory=dict)
    surfaces_order: List[str] = dataclasses.field(default_factory=lambda: [
        "prompts",
        "tools_orchestration",
        "telemetry",
        "retrieval_rag",
        "evaluation",
        "ios_coreml_mlx",
        "security",
    ])


def load_user_config(repo_root: Path) -> ConductorConfig:
    """
    Load optional config from:
      - .offllm-symbiosis.toml
      - .offllm-symbiosis.json

    TOML is preferred (py>=3.11). JSON always supported.
    """
    toml_p = repo_root / ".offllm-symbiosis.toml"
    json_p = repo_root / ".offllm-symbiosis.json"
    data: Dict[str, Any] = {}
    if toml_p.exists() and tomllib is not None:
        try:
            data = tomllib.loads(toml_p.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    elif json_p.exists():
        try:
            data = _read_json(json_p)
        except Exception:
            data = {}
    # Merge with defaults (shallow)
    cfg = ConductorConfig()
    if not data:
        return cfg
    # Safe pulls
    def _get_int(k: str, default: int) -> int:
        v = data.get(k, default)
        try:
            return int(v)
        except Exception:
            return default
    def _get_bool(k: str, default: bool) -> bool:
        v = data.get(k, default)
        return bool(v) if isinstance(v, bool) else default
    def _get_str(k: str, default: str) -> str:
        v = data.get(k, default)
        return str(v) if isinstance(v, (str, int, float)) else default

    extra = data.get("extra_search_patterns", {})
    if not isinstance(extra, dict):
        extra = {}

    order = data.get("surfaces_order", cfg.surfaces_order)
    if not isinstance(order, list) or not all(isinstance(x, str) for x in order):
        order = cfg.surfaces_order

    return ConductorConfig(
        max_hotspots=_get_int("max_hotspots", cfg.max_hotspots),
        churn_max_count=_get_int("churn_max_count", cfg.churn_max_count),
        rg_bin=_get_str("rg_bin", cfg.rg_bin),
        include_rg_commands=_get_bool("include_rg_commands", cfg.include_rg_commands),
        include_git_churn=_get_bool("include_git_churn", cfg.include_git_churn),
        extra_search_patterns={k: list(v) for k, v in extra.items() if isinstance(v, list)},
        surfaces_order=order,
    )


# ----------------------------
# SARIF parsing
# ----------------------------

def load_sarif_findings(sarif_path: Path) -> List[SarifFinding]:
    obj = _read_json(sarif_path)
    findings: List[SarifFinding] = []
    try:
        runs = obj.get("runs", [])
        if not runs:
            return []
        results = runs[0].get("results", [])
        for r in results:
            rule_id = str(r.get("ruleId", "unknown"))
            level = str(r.get("level", "note"))
            msg = str((r.get("message") or {}).get("text", ""))
            locs = r.get("locations") or []
            if not locs:
                continue
            pl = (locs[0].get("physicalLocation") or {})
            uri = str(((pl.get("artifactLocation") or {}).get("uri")) or "")
            region = pl.get("region") or {}
            start_line = region.get("startLine")
            start_line = int(start_line) if isinstance(start_line, int) else None
            findings.append(SarifFinding(rule_id=rule_id, level=level, message=msg, uri=uri, start_line=start_line))
    except Exception:
        return []
    return findings


# ----------------------------
# Planning logic
# ----------------------------

DEFAULT_RG_PATTERNS: Dict[str, List[str]] = {
    "prompts": [
        r"\bSYSTEM_PROMPT\b",
        r"\bsystem prompt\b",
        r"\bprompt_template\b",
        r"\bPROMPT_TEMPLATE\b",
        r"###\s*Instruction",
        r"###\s*Response",
    ],
    "tools_orchestration": [
        r"\btool(s)?\b",
        r"\bfunction_call\b",
        r"\btool_calls\b",
        r"\bToolRegistry\b",
        r"\bToolHandler\b",
        r"\bschema\b",
        r"\bjson schema\b",
    ],
    "telemetry": [
        r"\btelemetry\b",
        r"\bevent\b",
        r"\bredact\b",
        r"\bpii\b",
        r"\bhash\b",
        r"\blatenc(y|ies)\b",
        r"\btokens?\b",
    ],
    "retrieval_rag": [
        r"\bHNSW\b",
        r"\bvector\b",
        r"\bembed(ding|s)\b",
        r"\bchunk(ing)?\b",
        r"\bRAG\b",
        r"\bretriev(er|al)\b",
        r"\btop[-_ ]k\b",
        r"\brerank\b",
    ],
    "evaluation": [
        r"\bgolden\b",
        r"\beval\b",
        r"\bregression\b",
        r"\brefusal\b",
        r"\bjson validity\b",
        r"\bgrounded\b",
    ],
    "ios_coreml_mlx": [
        r"\bCoreML\b",
        r"\bcoremltools\b",
        r"\bMLX\b",
        r"\bmlx\b",
        r"\bANE\b",
        r"\bMetal\b",
        r"\bmlmodelc\b",
    ],
    "security": [
        r"\binjection\b",
        r"\bprompt injection\b",
        r"\bexfil\b",
        r"\btoken\b",
        r"\bsecret\b",
        r"\bkey\b",
        r"\bredact\b",
    ],
}

ACTION_TO_REFACTOR_TEMPLATES: Dict[str, Dict[str, Any]] = {
    "Standardise telemetry schema and redaction": {
        "acceptance": [
            "All telemetry events validate against JSON Schema in CI.",
            "PII redaction applied before writing to disk; unit tests include emails/tokens/keys.",
            "telemetry→SFT and telemetry→retrieval transforms are deterministic (stable hashes).",
        ],
        "deliverables": [
            "schemas/telemetry_event.schema.json",
            "src/utils/telemetry.{js,ts} updated to emit versioned schema ids",
            "scripts/mlops/telemetry_to_sft.py updated to validate input schema",
        ],
    },
    "Isolate retrieval + chunking into a single library surface": {
        "acceptance": [
            "Chunking outputs are stable: golden tests cover at least 20 representative documents.",
            "Runtime retrieval logs query+topk ids+scores into telemetry.",
            "Offline indexing uses the exact same chunker + embedding config as runtime.",
        ],
        "deliverables": [
            "src/retrieval/chunking.js (or .ts)",
            "src/retrieval/embedding_config.json",
            "eval/retrieval_eval.py extended with chunk distribution checks",
        ],
    },
    "Make evaluation first-class (golden set + regression gates)": {
        "acceptance": [
            "CI job runs eval suite and fails on regressions (JSON validity, tool parsing, refusal correctness).",
            "Golden cases are versioned and tied to prompt template version.",
        ],
        "deliverables": [
            "scripts/eval/golden_prompts.json expanded with ids + expected tool calls",
            "scripts/eval/run_prompt_regression.py wired into CI",
            "reports/ outputs include SARIF for GitHub code scanning",
        ],
    },
    "Harden tool-calling boundaries and injection resistance": {
        "acceptance": [
            "All tool args validated against schema before execution (reject unknown fields).",
            "Tool allowlist depends on capability context; tests cover allow/deny.",
            "Red-team eval cases included and run in CI.",
        ],
        "deliverables": [
            "schemas/tools/*.schema.json",
            "src/core/tools/ToolRegistry.js enforces schema+allowlist",
            "eval/redteam_tool_injection.json",
        ],
    },
}


def _surface_key_normalize(k: str) -> str:
    k = k.strip().lower()
    k = k.replace("-", "_").replace(" ", "_")
    return k


def _extract_where_to_search(report: Dict[str, Any]) -> Dict[str, List[str]]:
    w = report.get("where_to_search") or {}
    out: Dict[str, List[str]] = {}
    if isinstance(w, dict):
        for k, v in w.items():
            if isinstance(v, list):
                out[_surface_key_normalize(k)] = [str(x) for x in v if isinstance(x, str)]
    return out


def _extract_actions(report: Dict[str, Any]) -> List[Dict[str, Any]]:
    actions = report.get("actions") or []
    if isinstance(actions, list):
        return [a for a in actions if isinstance(a, dict)]
    return []


def _extract_prompt_clusters(report: Dict[str, Any]) -> List[Dict[str, Any]]:
    clusters = report.get("prompt_drift_clusters") or report.get("clusters") or []
    if isinstance(clusters, list):
        return [c for c in clusters if isinstance(c, dict)]
    return []


def build_rg_commands(cfg: ConductorConfig, repo_root: Path, where: Dict[str, List[str]]) -> Dict[str, List[str]]:
    """
    Create ripgrep commands per surface, targeted to the file lists from where_to_search.
    """
    cmds: Dict[str, List[str]] = {}
    patterns = dict(DEFAULT_RG_PATTERNS)
    # merge in user patterns
    for surf, pats in cfg.extra_search_patterns.items():
        patterns[_surface_key_normalize(surf)] = patterns.get(_surface_key_normalize(surf), []) + list(pats)

    for surf, files in where.items():
        pats = patterns.get(surf, [])
        if not pats:
            continue
        targets = [f for f in files if f and not f.startswith("reports/")]  # reports are already outputs
        if not targets:
            targets = files
        # Keep commands readable + robust (quote)
        cmd_list: List[str] = []
        for pat in pats:
            # limit to provided files if small, else directory
            if len(targets) <= 25:
                files_part = " ".join([f"'{t}'" for t in targets])
            else:
                files_part = "."
            cmd_list.append(f"{cfg.rg_bin} -n --hidden --no-ignore-vcs '{pat}' {files_part}")
        cmds[surf] = cmd_list
    return cmds


def compute_hotspots(
    repo_root: Path,
    where: Dict[str, List[str]],
    sarif: List[SarifFinding],
    cfg: ConductorConfig,
) -> List[Hotspot]:
    """
    Hotspot score heuristic:
      - base score from number of surfaces a file appears in
      - + SARIF findings weight
      - + git churn weight (bounded)
    """
    surfaces_by_file: Dict[str, List[str]] = {}
    for surf, files in where.items():
        for f in files:
            surfaces_by_file.setdefault(f, []).append(surf)

    sarif_by_file: Dict[str, List[SarifFinding]] = {}
    for s in sarif:
        sarif_by_file.setdefault(s.uri, []).append(s)

    # Candidates = union(where_to_search files, sarif uris)
    candidates = set(surfaces_by_file.keys()) | set(sarif_by_file.keys())
    out: List[Hotspot] = []
    use_git = cfg.include_git_churn and _is_git_repo(repo_root)

    for f in sorted(candidates):
        reasons: List[str] = []
        base = 0.0
        surfs = surfaces_by_file.get(f, [])
        if surfs:
            base += 10.0 * len(set(surfs))
            reasons.append(f"appears_in_surfaces={sorted(set(surfs))}")
        sfinds = sarif_by_file.get(f, [])
        if sfinds:
            # prompt-drift/hotspot results get extra weight
            w = 0.0
            for sf in sfinds:
                if sf.rule_id == "prompt-drift":
                    w += 15.0
                elif sf.rule_id == "hotspot":
                    w += 10.0
                else:
                    w += 5.0
            base += w
            reasons.append(f"sarif_findings={len(sfinds)}")
        churn = _git_recent_commit_count(repo_root, f, max_count=cfg.churn_max_count) if use_git else 0
        if churn:
            # log-ish scaling
            base += min(40.0, 8.0 * (churn ** 0.5))
            reasons.append(f"git_churn_commits~{churn}")

        if base <= 0:
            continue
        out.append(Hotspot(path=f, score=base, reasons=reasons, churn_commits=churn))

    out.sort(key=lambda h: (-h.score, h.path))
    return out[: cfg.max_hotspots]


def compare_baseline(current: Dict[str, Any], baseline: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compare report surfaces + actions + prompt clusters.
    Output is deterministic and safe to print in CI.
    """
    cur_where = _extract_where_to_search(current)
    base_where = _extract_where_to_search(baseline)

    def _setmap(d: Dict[str, List[str]]) -> Dict[str, set]:
        return {k: set(v) for k, v in d.items()}

    cur_sm = _setmap(cur_where)
    base_sm = _setmap(base_where)

    surf_keys = sorted(set(cur_sm.keys()) | set(base_sm.keys()))
    where_diff = {}
    for s in surf_keys:
        added = sorted(cur_sm.get(s, set()) - base_sm.get(s, set()))
        removed = sorted(base_sm.get(s, set()) - cur_sm.get(s, set()))
        if added or removed:
            where_diff[s] = {"added": added, "removed": removed}

    cur_actions = {(a.get("title") or ""): a for a in _extract_actions(current)}
    base_actions = {(a.get("title") or ""): a for a in _extract_actions(baseline)}
    action_titles = sorted(set(cur_actions.keys()) | set(base_actions.keys()))
    action_diff = {}
    for t in action_titles:
        if t not in base_actions:
            action_diff[t] = {"status": "new"}
        elif t not in cur_actions:
            action_diff[t] = {"status": "removed"}
        else:
            # compare priority + evidence set size
            ca, ba = cur_actions[t], base_actions[t]
            if (ca.get("priority") != ba.get("priority")) or (set(ca.get("evidence", [])) != set(ba.get("evidence", []))):
                action_diff[t] = {
                    "status": "changed",
                    "priority_from": ba.get("priority"),
                    "priority_to": ca.get("priority"),
                    "evidence_added": sorted(set(ca.get("evidence", [])) - set(ba.get("evidence", []))),
                    "evidence_removed": sorted(set(ba.get("evidence", [])) - set(ca.get("evidence", []))),
                }

    def _cluster_ids(r: Dict[str, Any]) -> set:
        ids = set()
        for c in _extract_prompt_clusters(r):
            cid = c.get("cluster_id") or c.get("id")
            if isinstance(cid, str):
                ids.add(cid)
        return ids

    cur_c = _cluster_ids(current)
    base_c = _cluster_ids(baseline)
    cluster_diff = {
        "added": sorted(cur_c - base_c),
        "removed": sorted(base_c - cur_c),
    }

    return {
        "where_to_search_diff": where_diff,
        "actions_diff": action_diff,
        "prompt_cluster_diff": cluster_diff,
    }


def build_fine_tune_manifest(where: Dict[str, List[str]], actions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Produce a manifest of training data sources and intended evals.
    This is meant to be consumed by your end-to-end pipeline as "what to harvest next".
    """
    # Map surfaces to dataset intents
    surface_to_intent = {
        "prompts": {"type": "prompt_registry", "weight": 3},
        "tools_orchestration": {"type": "tool_schemas_and_handlers", "weight": 3},
        "telemetry": {"type": "telemetry_events", "weight": 4},
        "retrieval_rag": {"type": "retrieval_pairs", "weight": 4},
        "evaluation": {"type": "eval_cases", "weight": 5},
        "ios_coreml_mlx": {"type": "on_device_export_equivalence", "weight": 2},
        "security": {"type": "tool_safety_and_redaction", "weight": 5},
    }

    sources: List[Dict[str, Any]] = []
    for surf, files in where.items():
        intent = surface_to_intent.get(surf)
        if not intent:
            continue
        for f in sorted(set(files)):
            sources.append({"surface": surf, "intent": intent["type"], "weight": intent["weight"], "path": f})

    # eval plan from action titles (deterministic subset)
    evals: List[str] = []
    for a in actions:
        t = str(a.get("title") or "")
        if "evaluation" in t.lower() or "eval" in t.lower():
            evals.extend([
                "prompt_regression",
                "tool_json_validity",
                "refusal_correctness",
                "citation_groundedness",
            ])
        if "telemetry" in t.lower():
            evals.append("telemetry_schema_validation")
        if "tool-calling" in t.lower() or "tool" in t.lower():
            evals.append("tool_selection_accuracy")
        if "retrieval" in t.lower() or "chunk" in t.lower():
            evals.extend(["retrieval_recall_at_k", "chunk_stability"])

    evals = sorted(set(evals))
    return {
        "version": "v1",
        "generated_at": _utc_now(),
        "sources": sources,
        "recommended_evals": evals,
    }


def action_backlog(actions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for a in actions:
        title = str(a.get("title") or "")
        template = ACTION_TO_REFACTOR_TEMPLATES.get(title, {})
        out.append({
            "priority": a.get("priority", "med"),
            "title": title,
            "why": a.get("why", ""),
            "next_steps": a.get("next_steps", []),
            "evidence": a.get("evidence", []),
            "acceptance": template.get("acceptance", []),
            "deliverables": template.get("deliverables", []),
        })
    # high before med before low
    prio_rank = {"high": 0, "med": 1, "low": 2}
    out.sort(key=lambda x: (prio_rank.get(str(x.get("priority")), 9), str(x.get("title"))))
    return out


# ----------------------------
# Markdown report rendering
# ----------------------------

def render_md(
    repo_root: Path,
    report_path: Path,
    sarif_path: Optional[Path],
    cfg: ConductorConfig,
    fingerprint: str,
    where: Dict[str, List[str]],
    rg_cmds: Dict[str, List[str]],
    hotspots: List[Hotspot],
    backlog: List[Dict[str, Any]],
    baseline_diff: Optional[Dict[str, Any]],
) -> str:
    lines: List[str] = []
    lines.append(f"# offLLM Symbiosis Conductor Report (v1)")
    lines.append("")
    lines.append(f"- Generated: **{_utc_now()}**")
    lines.append(f"- Repo root: `{repo_root}`")
    lines.append(f"- Repo fingerprint: `{fingerprint}`")
    lines.append(f"- Input report: `{report_path}`")
    if sarif_path:
        lines.append(f"- Input SARIF: `{sarif_path}`")
    lines.append("")

    # Where to search
    lines.append("## Where to search (from Symbiosis Advisor)")
    lines.append("")
    for surf in cfg.surfaces_order:
        files = where.get(surf)
        if not files:
            continue
        lines.append(f"### {surf}")
        for f in files:
            lines.append(f"- `{f}`")
        lines.append("")
        if cfg.include_rg_commands and rg_cmds.get(surf):
            lines.append("Suggested ripgrep probes:")
            lines.append("")
            for cmd in rg_cmds[surf][:6]:
                lines.append(f"- `{cmd}`")
            lines.append("")

    # Hotspots
    lines.append("## Hotspots (ranked)")
    lines.append("")
    for h in hotspots:
        lines.append(f"- **{h.path}** — score={h.score:.1f}, churn={h.churn_commits}, reasons={'; '.join(h.reasons)}")
    lines.append("")

    # Backlog
    lines.append("## Refactor backlog (acceptance-test shaped)")
    lines.append("")
    for b in backlog:
        lines.append(f"### {b['title']} ({b.get('priority','med')})")
        why = str(b.get("why") or "").strip()
        if why:
            lines.append(f"**Why:** {why}")
            lines.append("")
        ns = b.get("next_steps") or []
        if ns:
            lines.append("**Next steps:**")
            for s in ns:
                lines.append(f"- {s}")
            lines.append("")
        acc = b.get("acceptance") or []
        if acc:
            lines.append("**Acceptance checks:**")
            for s in acc:
                lines.append(f"- {s}")
            lines.append("")
        dels = b.get("deliverables") or []
        if dels:
            lines.append("**Suggested deliverables:**")
            for s in dels:
                lines.append(f"- `{s}`")
            lines.append("")
        ev = b.get("evidence") or []
        if ev:
            lines.append("**Evidence files:**")
            for s in ev[:15]:
                lines.append(f"- `{s}`")
            if len(ev) > 15:
                lines.append(f"- … and {len(ev)-15} more")
            lines.append("")

    # Baseline diff
    if baseline_diff:
        lines.append("## Baseline comparison")
        lines.append("")
        wdiff = baseline_diff.get("where_to_search_diff") or {}
        if wdiff:
            lines.append("### where_to_search drift")
            for surf, d in sorted(wdiff.items()):
                add = d.get("added") or []
                rem = d.get("removed") or []
                if add:
                    lines.append(f"- **{surf}** added: {len(add)}")
                if rem:
                    lines.append(f"- **{surf}** removed: {len(rem)}")
            lines.append("")
        adiff = baseline_diff.get("actions_diff") or {}
        if adiff:
            lines.append("### action item drift")
            for title, d in sorted(adiff.items()):
                lines.append(f"- **{title}**: {d.get('status')}")
            lines.append("")
        cdiff = baseline_diff.get("prompt_cluster_diff") or {}
        if cdiff.get("added") or cdiff.get("removed"):
            lines.append("### prompt cluster drift")
            if cdiff.get("added"):
                lines.append(f"- added: {cdiff['added']}")
            if cdiff.get("removed"):
                lines.append(f"- removed: {cdiff['removed']}")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


# ----------------------------
# CLI
# ----------------------------

def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="offLLM Symbiosis Conductor (v1)")
    ap.add_argument("--repo", required=True, help="Repo root (e.g. /home/ales27pm/offLLM-1)")
    ap.add_argument("--report", required=True, help="Path to symbiosis_deep_report.json")
    ap.add_argument("--sarif", default=None, help="Optional path to symbiosis_deep_report.sarif.json")
    ap.add_argument("--baseline", default=None, help="Optional baseline report json to compare against")
    ap.add_argument("--out", required=True, help="Output directory (will be created)")
    ap.add_argument("--max-hotspots", type=int, default=None, help="Override max hotspots")
    args = ap.parse_args(argv)

    repo_root = Path(args.repo).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    sarif_path = Path(args.sarif).expanduser().resolve() if args.sarif else None
    baseline_path = Path(args.baseline).expanduser().resolve() if args.baseline else None
    out_dir = Path(args.out).expanduser().resolve()

    if not repo_root.exists():
        print(f"[error] repo not found: {repo_root}", file=sys.stderr)
        return 2
    if not report_path.exists():
        print(f"[error] report not found: {report_path}", file=sys.stderr)
        return 2
    if sarif_path and not sarif_path.exists():
        print(f"[error] sarif not found: {sarif_path}", file=sys.stderr)
        return 2
    if baseline_path and not baseline_path.exists():
        print(f"[error] baseline not found: {baseline_path}", file=sys.stderr)
        return 2

    cfg = load_user_config(repo_root)
    if args.max_hotspots is not None:
        cfg = dataclasses.replace(cfg, max_hotspots=int(args.max_hotspots))

    fingerprint = _stable_repo_fingerprint(repo_root)

    report = _read_json(report_path)
    where = _extract_where_to_search(report)
    actions = _extract_actions(report)

    sarif_findings: List[SarifFinding] = []
    if sarif_path:
        sarif_findings = load_sarif_findings(sarif_path)

    rg_cmds = build_rg_commands(cfg, repo_root, where) if cfg.include_rg_commands else {}
    hotspots = compute_hotspots(repo_root, where, sarif_findings, cfg)

    backlog = action_backlog(actions)
    manifest = build_fine_tune_manifest(where, actions)

    baseline_diff = None
    if baseline_path:
        baseline = _read_json(baseline_path)
        baseline_diff = compare_baseline(report, baseline)

    # Write outputs
    out_dir.mkdir(parents=True, exist_ok=True)
    md = render_md(
        repo_root=repo_root,
        report_path=report_path,
        sarif_path=sarif_path,
        cfg=cfg,
        fingerprint=fingerprint,
        where=where,
        rg_cmds=rg_cmds,
        hotspots=hotspots,
        backlog=backlog,
        baseline_diff=baseline_diff,
    )
    _write_text(out_dir / "symbiosis_conductor_report.md", md)

    _write_json(out_dir / "symbiosis_conductor_report.json", {
        "version": "v1",
        "generated_at": _utc_now(),
        "repo_root": str(repo_root),
        "repo_fingerprint": fingerprint,
        "inputs": {
            "report": str(report_path),
            "sarif": str(sarif_path) if sarif_path else None,
            "baseline": str(baseline_path) if baseline_path else None,
        },
        "where_to_search": where,
        "hotspots": [dataclasses.asdict(h) for h in hotspots],
        "backlog": backlog,
        "fine_tune_manifest": manifest,
        "baseline_diff": baseline_diff,
    })

    _write_json(out_dir / "fine_tune_manifest.json", manifest)

    # Print small, CI-friendly summary
    print(f"[ok] wrote: {out_dir / 'symbiosis_conductor_report.md'}")
    print(f"[ok] wrote: {out_dir / 'fine_tune_manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
