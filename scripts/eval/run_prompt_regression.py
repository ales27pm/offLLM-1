#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------
# Utilities
# ---------------------------

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _read_json(path: Path) -> Any:
    return json.loads(_read_text(path))


def _write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, sort_keys=True), encoding="utf-8")


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _is_plain_object(x: Any) -> bool:
    return isinstance(x, dict)


def _normalise_golden(parsed: Any) -> Dict[str, Any]:
    # legacy: [ ...cases ]
    if isinstance(parsed, list):
        return {"cases": parsed}

    # current: { cases: [ ...cases ], ...meta }
    if isinstance(parsed, dict) and isinstance(parsed.get("cases"), list):
        return parsed

    raise ValueError("prompt JSON must be either an array OR { cases: [...] }")


def _best_effort_case_location(raw_json: str, stable_id: str) -> Tuple[int, int]:
    """
    Best-effort line/column finder for SARIF regions.
    We search for the stable_id string occurrence in the raw JSON text.
    """
    if not stable_id or stable_id in ("(unknown)", "(file)"):
        return (1, 1)

    needle = f"\"stable_id\""
    idx = raw_json.find(needle)
    # Prefer finding around the specific stable_id value
    stable_val = f"\"{stable_id}\""
    idx2 = raw_json.find(stable_val)
    if idx2 != -1:
        idx = idx2

    if idx == -1:
        return (1, 1)

    # Compute 1-based line/column
    before = raw_json[:idx]
    line = before.count("\n") + 1
    last_nl = before.rfind("\n")
    if last_nl == -1:
        col = idx + 1
    else:
        col = idx - last_nl
    return (line, max(1, col))


# ---------------------------
# Data model
# ---------------------------

@dataclass(frozen=True)
class Finding:
    prompts_path: str
    stable_id: str
    kind: str  # schema | mismatch | missing_baseline | note
    message: str
    expected_hash: Optional[str] = None
    actual_hash: Optional[str] = None


# ---------------------------
# SARIF
# ---------------------------

def _sarif_location(uri: str, line: int, col: int) -> Dict[str, Any]:
    return {
        "physicalLocation": {
            "artifactLocation": {"uri": uri},
            "region": {
                "startLine": int(line),
                "startColumn": int(col),
            },
        }
    }


def _sarif_result(rule_id: str, level: str, message: str, props: Dict[str, Any], locations: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "ruleId": rule_id,
        "level": level,
        "message": {"text": message},
        "properties": props,
        "locations": locations if locations else [_sarif_location(props.get("prompts_path", "unknown"), 1, 1)],
    }


def build_sarif(findings: List[Finding], rule_meta: Dict[str, Any]) -> Dict[str, Any]:
    tool = {
        "driver": {
            "name": "offLLM prompt regression",
            "informationUri": "https://github.com/ales27pm/offLLM-1",
            "rules": [
                {
                    "id": "PROMPT_REGRESSION",
                    "name": "Prompt regression mismatch",
                    "shortDescription": {"text": "Golden prompt hash mismatch"},
                },
                {
                    "id": "PROMPT_REGRESSION_SCHEMA",
                    "name": "Golden prompt schema invalid",
                    "shortDescription": {"text": "Golden prompt file/schema invalid"},
                },
                {
                    "id": "PROMPT_REGRESSION_BASELINE",
                    "name": "Golden prompt baseline missing",
                    "shortDescription": {"text": "expected_prompt_hash missing"},
                },
            ],
        }
    }

    results: List[Dict[str, Any]] = []
    for f in findings:
        props = {
            "stable_id": f.stable_id,
            "prompts_path": f.prompts_path,
            "expected_hash": f.expected_hash,
            "actual_hash": f.actual_hash,
        }

        # Always include at least one location (GitHub Code Scanning requires it).
        line = rule_meta.get((f.prompts_path, f.stable_id), (1, 1))[0]
        col = rule_meta.get((f.prompts_path, f.stable_id), (1, 1))[1]
        locs = [_sarif_location(f.prompts_path, line, col)]

        if f.kind == "schema":
            results.append(_sarif_result("PROMPT_REGRESSION_SCHEMA", "error", f.message, props, locs))
        elif f.kind == "mismatch":
            results.append(_sarif_result("PROMPT_REGRESSION", "error", f.message, props, locs))
        elif f.kind == "missing_baseline":
            results.append(_sarif_result("PROMPT_REGRESSION_BASELINE", "warning", f.message, props, locs))
        else:
            results.append(_sarif_result("PROMPT_REGRESSION", "note", f.message, props, locs))

    return {
        "version": "2.1.0",
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "runs": [
            {
                "tool": tool,
                "results": results,
            }
        ],
    }


# ---------------------------
# Validation
# ---------------------------

def _validate_case(entry: Dict[str, Any]) -> List[str]:
    errs: List[str] = []

    if not isinstance(entry.get("stable_id"), str) or not entry["stable_id"]:
        errs.append("stable_id must be a non-empty string")

    if not isinstance(entry.get("user_prompt"), str):
        errs.append("user_prompt must be a string")

    # tools
    tools = entry.get("tools")
    if not isinstance(tools, list):
        errs.append("tools must be an array")
    else:
        for i, t in enumerate(tools):
            if not isinstance(t, dict):
                errs.append(f"tools[{i}] must be an object")
                continue
            if not isinstance(t.get("name"), str) or not t["name"]:
                errs.append(f"tools[{i}].name must be a non-empty string")
            if not isinstance(t.get("description"), str) or not t["description"]:
                errs.append(f"tools[{i}].description must be a non-empty string")
            if not isinstance(t.get("parameters"), dict):
                errs.append(f"tools[{i}].parameters must be an object")

    # context
    ctx = entry.get("context")
    if not isinstance(ctx, list):
        errs.append("context must be an array")
    else:
        for i, c in enumerate(ctx):
            if isinstance(c, str):
                continue
            if not isinstance(c, dict):
                errs.append(f"context[{i}] must be a string or object with content")
                continue
            if not isinstance(c.get("content"), str):
                errs.append(f"context[{i}].content must be a string")

    # expected
    expected = entry.get("expected")
    if not isinstance(expected, dict):
        errs.append("expected must be an object")
    else:
        if not isinstance(expected.get("tool_calls"), list):
            errs.append("expected.tool_calls must be an array")
        if not isinstance(expected.get("json_valid"), bool):
            errs.append("expected.json_valid must be a boolean")
        if not isinstance(expected.get("refusal"), bool):
            errs.append("expected.refusal must be a boolean")
        if not isinstance(expected.get("citations_required"), bool):
            errs.append("expected.citations_required must be a boolean")

    # expected_prompt_hash (optional but strict when present)
    eph = entry.get("expected_prompt_hash")
    if eph is not None:
        if not isinstance(eph, str):
            errs.append("expected_prompt_hash must be a string when present")
        else:
            if not re.fullmatch(r"[0-9a-fA-F]{64}", eph):
                errs.append("expected_prompt_hash must be sha256 hex (64 chars)")

    return errs


# ---------------------------
# “Full” regression (optional)
# ---------------------------

def _run_model_cmd(model_cmd: str, prompt: str, timeout_s: int = 120) -> Tuple[int, str, str]:
    """
    Runs the model command as a shell command, sending prompt on stdin.
    Returns (returncode, stdout, stderr).

    This is intentionally generic. Your OFFLLM_EVAL_MODEL_CMD should accept input on stdin
    and emit output on stdout.
    """
    p = subprocess.run(
        model_cmd,
        input=prompt.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        shell=True,
        timeout=timeout_s,
        check=False,
    )
    return p.returncode, p.stdout.decode("utf-8", errors="replace"), p.stderr.decode("utf-8", errors="replace")


# ---------------------------
# CLI
# ---------------------------

def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run golden prompt regression checks and emit JSON + SARIF.")
    p.add_argument(
        "--prompts",
        action="append",
        default=[],
        help="Path to a prompt JSON file (repeatable). Supports array or {cases:[...]} layouts.",
    )
    p.add_argument("--report-out", required=True, help="Path to write JSON report.")
    p.add_argument("--sarif-out", required=True, help="Path to write SARIF report.")
    p.add_argument("--strict", action="store_true", help="Fail if expected_prompt_hash is missing in any case.")
    p.add_argument("--no-fail", action="store_true", help="Never exit non-zero (useful for CI diagnostics).")
    p.add_argument(
        "--model-cmd",
        default="",
        help="Optional: command to run model evaluation (read prompt on stdin). If omitted, schema-only mode.",
    )
    p.add_argument("--model-timeout", type=int, default=120, help="Timeout seconds for model command per prompt.")
    return p.parse_args(argv)


# ---------------------------
# Main
# ---------------------------

def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    prompts_paths = [Path(p) for p in (args.prompts or [])]
    if not prompts_paths:
        prompts_paths = [Path("scripts/eval/golden_prompts.json")]

    report_out = Path(args.report_out)
    sarif_out = Path(args.sarif_out)

    findings: List[Finding] = []
    rule_meta: Dict[Tuple[str, str], Tuple[int, int]] = {}

    report: Dict[str, Any] = {
        "tool": "offLLM prompt regression",
        "ts": _utc_now_iso(),
        "prompts": [str(p) for p in prompts_paths],
        "mode": "full" if (args.model_cmd or "").strip() else "schema_only",
        "failed": False,
        "files": [],
        "totals": {
            "cases_total": 0,
            "cases_checked": 0,
            "schema_errors": 0,
            "missing_baselines": 0,
            "mismatches": 0,
            "notes": 0,
        },
    }

    any_hard_fail = False

    for prompts_path in prompts_paths:
        file_entry: Dict[str, Any] = {
            "path": str(prompts_path),
            "cases_total": 0,
            "cases_checked": 0,
            "schema_errors": 0,
            "missing_baselines": 0,
            "mismatches": 0,
            "results": [],
        }

        try:
            raw = _read_text(prompts_path)
            parsed = json.loads(raw)
            golden = _normalise_golden(parsed)
        except Exception as e:
            msg = f"Failed to load prompts: {e}"
            findings.append(Finding(prompts_path=str(prompts_path), stable_id="(file)", kind="schema", message=msg))
            report["totals"]["schema_errors"] += 1
            file_entry["schema_errors"] += 1
            file_entry["results"].append({"stable_id": "(file)", "status": "schema_error", "error": msg})
            report["files"].append(file_entry)
            any_hard_fail = True
            continue

        cases = golden.get("cases", [])
        file_entry["cases_total"] = len(cases)
        report["totals"]["cases_total"] += len(cases)

        # record best-effort locations for SARIF
        # (if file is huge, still fine—this is one pass per file)
        for entry in cases:
            if _is_plain_object(entry):
                sid = str(entry.get("stable_id", "(unknown)"))
                rule_meta[(str(prompts_path), sid)] = _best_effort_case_location(raw, sid)

        for entry in cases:
            if not _is_plain_object(entry):
                msg = "case entry must be an object"
                findings.append(Finding(prompts_path=str(prompts_path), stable_id="(unknown)", kind="schema", message=msg))
                report["totals"]["schema_errors"] += 1
                file_entry["schema_errors"] += 1
                file_entry["results"].append({"stable_id": "(unknown)", "status": "schema_error", "error": msg})
                any_hard_fail = True
                continue

            stable_id = str(entry.get("stable_id", "(unknown)"))
            errs = _validate_case(entry)
            if errs:
                msg = "; ".join(errs)
                findings.append(Finding(prompts_path=str(prompts_path), stable_id=stable_id, kind="schema", message=msg))
                report["totals"]["schema_errors"] += 1
                file_entry["schema_errors"] += 1
                file_entry["results"].append({"stable_id": stable_id, "status": "schema_error", "error": msg})
                any_hard_fail = True
                continue

            report["totals"]["cases_checked"] += 1
            file_entry["cases_checked"] += 1
            file_entry["results"].append({"stable_id": stable_id, "status": "schema_ok"})

            eph = entry.get("expected_prompt_hash")
            if eph is None:
                msg = "expected_prompt_hash missing (baseline not locked yet)"
                findings.append(Finding(prompts_path=str(prompts_path), stable_id=stable_id, kind="missing_baseline", message=msg))
                report["totals"]["missing_baselines"] += 1
                file_entry["missing_baselines"] += 1
                if args.strict:
                    any_hard_fail = True
                continue

            # If model-cmd provided, do “full mode” checks (optional, generic).
            # NOTE: This does NOT build the prompt itself (that’s Jest territory in your repo).
            # It merely proves the model command can run on input and produces output.
            if (args.model_cmd or "").strip():
                user_prompt = entry.get("user_prompt", "")
                rc, out, err = _run_model_cmd(args.model_cmd, str(user_prompt), timeout_s=int(args.model_timeout))
                if rc != 0:
                    msg = f"model-cmd failed (rc={rc}). stderr: {err.strip()[:500]}"
                    findings.append(Finding(prompts_path=str(prompts_path), stable_id=stable_id, kind="mismatch", message=msg))
                    report["totals"]["mismatches"] += 1
                    file_entry["mismatches"] += 1
                    any_hard_fail = True
                else:
                    # deterministic “smoke hash” of model output (not a golden hash)
                    smoke_hash = _sha256_hex(out)
                    file_entry["results"][-1].update({"model_rc": 0, "model_out_sha256": smoke_hash})

        report["files"].append(file_entry)

    report["failed"] = bool(any_hard_fail)

    # Always write artifacts
    _write_json(report_out, report)
    _write_json(sarif_out, build_sarif(findings, rule_meta))

    # Exit policy
    if args.no_fail:
        return 0

    # non-strict: fail only on schema errors / mismatches / model failures
    # strict: also fail on missing baselines
    if report["totals"]["schema_errors"] > 0:
        return 1
    if report["totals"]["mismatches"] > 0:
        return 1
    if args.strict and report["totals"]["missing_baselines"] > 0:
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
