#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


def _utc_now_iso() -> str:
  return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path) -> Any:
  raw = path.read_text(encoding="utf-8")
  return json.loads(raw)


def _write_json(path: Path, obj: Any) -> None:
  path.parent.mkdir(parents=True, exist_ok=True)
  path.write_text(json.dumps(obj, indent=2, sort_keys=True), encoding="utf-8")


def _sha256_hex(s: str) -> str:
  return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _normalise_golden(parsed: Any) -> Dict[str, Any]:
  # legacy: [ ...cases ]
  if isinstance(parsed, list):
    return {"cases": parsed}

  # current: { cases: [ ...cases ], ...meta }
  if isinstance(parsed, dict) and isinstance(parsed.get("cases"), list):
    return parsed

  raise ValueError("golden_prompts.json must be either an array OR { cases: [...] }")


def _is_plain_object(x: Any) -> bool:
  return isinstance(x, dict)


@dataclass(frozen=True)
class Finding:
  stable_id: str
  title: str
  kind: str
  message: str
  expected_hash: Optional[str]
  actual_hash: Optional[str]


def _workspace_root() -> Path:
  # In GitHub Actions, GITHUB_WORKSPACE is the repo root.
  ws = os.environ.get("GITHUB_WORKSPACE")
  if ws:
    return Path(ws).resolve()
  return Path.cwd().resolve()


def _pick_default_relpath(golden_path: Path, repo_root: Path) -> str:
  """
  Prefer pointing SARIF locations at the golden file (the "thing" we're validating).
  If it doesn't exist, fall back to this script's path so Code Scanning still has
  a valid location.
  """
  try:
    if golden_path.exists():
      return str(golden_path.resolve().relative_to(repo_root))
  except Exception:
    pass
  return "scripts/eval/run_prompt_regression.py"


def _sarif_location(repo_root: Path, rel_path: str, start_line: int = 1) -> Dict[str, Any]:
  # GitHub Code Scanning requires each result to have at least one location.
  abs_path = (repo_root / rel_path).resolve()
  return {
    "physicalLocation": {
      "artifactLocation": {"uri": abs_path.as_uri()},
      "region": {"startLine": int(start_line)},
    }
  }


def _sarif_result(
  rule_id: str,
  level: str,
  message: str,
  stable_id: str,
  repo_root: Path,
  rel_path: str,
  start_line: int = 1,
) -> Dict[str, Any]:
  return {
    "ruleId": rule_id,
    "level": level,
    "message": {"text": message},
    "locations": [_sarif_location(repo_root, rel_path, start_line)],
    "properties": {"stable_id": stable_id},
  }


def build_sarif(findings: List[Finding], repo_root: Path, rel_path: str) -> Dict[str, Any]:
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
      ],
    }
  }

  results: List[Dict[str, Any]] = []
  for f in findings:
    # Put everything on the same file+line unless you want per-case mapping later.
    start_line = 1

    if f.kind == "schema":
      results.append(
        _sarif_result(
          "PROMPT_REGRESSION_SCHEMA",
          "error",
          f.message,
          f.stable_id,
          repo_root,
          rel_path,
          start_line,
        )
      )
    elif f.kind == "mismatch":
      results.append(
        _sarif_result(
          "PROMPT_REGRESSION",
          "error",
          f.message,
          f.stable_id,
          repo_root,
          rel_path,
          start_line,
        )
      )
    elif f.kind == "missing_baseline":
      results.append(
        _sarif_result(
          "PROMPT_REGRESSION",
          "warning",
          f.message,
          f.stable_id,
          repo_root,
          rel_path,
          start_line,
        )
      )
    else:
      results.append(
        _sarif_result(
          "PROMPT_REGRESSION",
          "note",
          f.message,
          f.stable_id,
          repo_root,
          rel_path,
          start_line,
        )
      )

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


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
  p = argparse.ArgumentParser(description="Run golden prompt regression checks and emit JSON + SARIF.")
  p.add_argument(
    "--golden",
    default=str(Path("scripts/eval/golden_prompts.json")),
    help="Path to golden_prompts.json",
  )
  p.add_argument(
    "--report-out",
    required=True,
    help="Path to write JSON report (machine-readable).",
  )
  p.add_argument(
    "--sarif-out",
    required=True,
    help="Path to write SARIF report (for code scanning upload).",
  )
  p.add_argument(
    "--strict",
    action="store_true",
    help="Fail if expected_prompt_hash is missing in any case.",
  )
  p.add_argument(
    "--no-fail",
    action="store_true",
    help="Never exit non-zero (useful for diagnostics-only runs).",
  )
  return p.parse_args(argv)


def _validate_case(entry: Dict[str, Any]) -> List[str]:
  errs: List[str] = []
  if not isinstance(entry.get("stable_id"), str) or not entry["stable_id"]:
    errs.append("stable_id must be a non-empty string")

  if not isinstance(entry.get("user_prompt"), str):
    errs.append("user_prompt must be a string")

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

  eph = entry.get("expected_prompt_hash")
  if eph is not None:
    if not isinstance(eph, str):
      errs.append("expected_prompt_hash must be a string when present")
    else:
      # strict sha256 hex
      import re
      if not re.fullmatch(r"[0-9a-fA-F]{64}", eph):
        errs.append("expected_prompt_hash must be sha256 hex (64 chars)")

  return errs


def main(argv: Optional[List[str]] = None) -> int:
  args = parse_args(argv)

  repo_root = _workspace_root()

  golden_path = Path(args.golden)
  report_out = Path(args.report_out)
  sarif_out = Path(args.sarif_out)

  findings: List[Finding] = []
  report: Dict[str, Any] = {
    "tool": "offLLM prompt regression",
    "ts": _utc_now_iso(),
    "golden_path": str(golden_path),
    "repo_root": str(repo_root),
    "cases_total": 0,
    "cases_checked": 0,
    "mismatches": 0,
    "missing_baselines": 0,
    "schema_errors": 0,
    "notes": [],
    "results": [],
  }

  rel_path_for_sarif = _pick_default_relpath(golden_path, repo_root)

  try:
    parsed = _read_json(golden_path)
    golden = _normalise_golden(parsed)
  except Exception as e:
    msg = f"Failed to load golden prompts: {e}"
    findings.append(
      Finding(
        stable_id="(file)",
        title="golden_prompts.json",
        kind="schema",
        message=msg,
        expected_hash=None,
        actual_hash=None,
      )
    )
    report["schema_errors"] += 1
    _write_json(report_out, report)
    _write_json(sarif_out, build_sarif(findings, repo_root=repo_root, rel_path=rel_path_for_sarif))
    return 1 if not args.no_fail else 0

  cases = golden.get("cases", [])
  report["cases_total"] = len(cases)

  # We *avoid* importing JS here (CI may not have node deps installed in this step).
  # This runner focuses on schema + baseline availability + placeholder hash checks.
  # Real prompt building/hash assertions are handled by Jest tests.
  for entry in cases:
    if not _is_plain_object(entry):
      report["schema_errors"] += 1
      findings.append(
        Finding(
          stable_id="(unknown)",
          title="(unknown)",
          kind="schema",
          message="case entry must be an object",
          expected_hash=None,
          actual_hash=None,
        )
      )
      continue

    stable_id = entry.get("stable_id", "(unknown)")
    title = entry.get("title", stable_id)

    errs = _validate_case(entry)
    if errs:
      report["schema_errors"] += 1
      findings.append(
        Finding(
          stable_id=str(stable_id),
          title=str(title),
          kind="schema",
          message="; ".join(errs),
          expected_hash=entry.get("expected_prompt_hash"),
          actual_hash=None,
        )
      )
      continue

    report["cases_checked"] += 1

    eph = entry.get("expected_prompt_hash")
    if eph is None:
      report["missing_baselines"] += 1
      findings.append(
        Finding(
          stable_id=str(stable_id),
          title=str(title),
          kind="missing_baseline",
          message="expected_prompt_hash missing (baseline not locked yet)",
          expected_hash=None,
          actual_hash=None,
        )
      )
      if args.strict:
        report["mismatches"] += 1  # treat as failure in strict mode
      report["results"].append(
        {"stable_id": stable_id, "title": title, "status": "missing_baseline"}
      )
      continue

    # If the baseline exists, we still can’t compute the real prompt hash here without JS,
    # so we just acknowledge that a baseline exists.
    report["results"].append(
      {
        "stable_id": stable_id,
        "title": title,
        "status": "baseline_present",
        "expected_prompt_hash": eph,
      }
    )

  # Write artifacts always.
  _write_json(report_out, report)
  _write_json(sarif_out, build_sarif(findings, repo_root=repo_root, rel_path=rel_path_for_sarif))

  # Exit code policy:
  # - non-strict: only fail on schema errors
  # - strict: fail on schema errors OR missing baselines
  if args.no_fail:
    return 0

  if report["schema_errors"] > 0:
    return 1
  if args.strict and report["missing_baselines"] > 0:
    return 1
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
