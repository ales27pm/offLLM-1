#!/usr/bin/env python3
"""
scripts/eval/run_prompt_regression.py

Prompt regression runner for CI.

What it does (deterministic, offline):
- Loads scripts/eval/golden_prompts.json (supports either:
    1) { "cases": [ ... ] }
    2) [ ... ]  (legacy)
  and normalises to { "cases": [...] }.
- Validates a strict schema contract for each case.
- If a case includes expected_prompt_hash, computes sha256(prompt) and compares.
- Writes:
    - JSON report (--report-out)
    - SARIF report (--sarif-out)

Exit codes:
- 0 if all checks pass
- 1 if any check fails
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="run_prompt_regression.py")
    p.add_argument(
        "--golden",
        default=str(Path("scripts") / "eval" / "golden_prompts.json"),
        help="Path to golden_prompts.json (default: scripts/eval/golden_prompts.json)",
    )
    p.add_argument(
        "--report-out",
        required=True,
        help="Write JSON report to this path",
    )
    p.add_argument(
        "--sarif-out",
        required=True,
        help="Write SARIF report to this path",
    )
    p.add_argument(
        "--strict",
        action="store_true",
        help="Fail if a case is missing expected_prompt_hash (default: allow missing)",
    )
    return p.parse_args(argv)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _write_json(path: Path, obj: Any) -> None:
    _write_text(path, json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n")


def _sha256_hex(s: str) -> str:
    h = hashlib.sha256()
    # Normalise line endings deterministically
    norm = s.replace("\r\n", "\n").replace("\r", "\n")
    h.update(norm.encode("utf-8"))
    return h.hexdigest()


def _is_plain_object(x: Any) -> bool:
    return isinstance(x, dict)


def _normalise_golden_payload(payload: Any) -> Dict[str, Any]:
    """
    Supports:
      - legacy: [ ...cases ]
      - current: { "cases": [ ...cases ], ...meta }
    Always returns: { "cases": [...] , ...meta_if_any }
    """
    if isinstance(payload, list):
        return {"cases": payload}
    if isinstance(payload, dict) and isinstance(payload.get("cases"), list):
        return payload
    shape = "null" if payload is None else type(payload).__name__
    raise ValueError(
        f"golden_prompts.json must be either a list of cases OR an object with {{cases:[...]}}. Got: {shape}"
    )


@dataclass(frozen=True)
class Finding:
    stable_id: str
    kind: str  # "schema" | "hash"
    message: str
    file: str


def _validate_case_schema(entry: Dict[str, Any]) -> List[str]:
    """
    Strict schema contract expected by JS tests.

    Required:
      stable_id: str
      user_prompt: str
      tools: list[ {name, description, parameters} ]
      context: list[str | {content: str, ...}]
      expected: { tool_calls: list[{name, args}], json_valid: bool, refusal: bool, citations_required: bool }

    Optional:
      prompt (if present must match user_prompt)
      expected_prompt_hash (if present must be sha256 hex)
      sarif_category
      legacy compatibility fields: expected_tool_calls, expects_json, expects_refusal, requires_citations
    """
    errors: List[str] = []

    allowed_top = {
        "stable_id",
        "prompt",
        "tools",
        "context",
        "user_prompt",
        "expected_prompt_hash",
        "sarif_category",
        "expected",
        "expected_tool_calls",
        "expects_json",
        "expects_refusal",
        "requires_citations",
    }
    for k in entry.keys():
        if k not in allowed_top:
            errors.append(f"unknown top-level key: {k}")

    stable_id = entry.get("stable_id")
    if not isinstance(stable_id, str) or not stable_id.strip():
        errors.append("stable_id must be a non-empty string")

    user_prompt = entry.get("user_prompt")
    if not isinstance(user_prompt, str):
        errors.append("user_prompt must be a string")

    prompt = entry.get("prompt", None)
    if prompt is not None:
        if not isinstance(prompt, str):
            errors.append("prompt must be a string when present")
        elif isinstance(user_prompt, str) and prompt != user_prompt:
            errors.append("prompt must equal user_prompt when both are present")

    tools = entry.get("tools")
    if not isinstance(tools, list):
        errors.append("tools must be an array")
    else:
        for i, t in enumerate(tools):
            if not isinstance(t, dict):
                errors.append(f"tools[{i}] must be an object")
                continue
            if not isinstance(t.get("name"), str) or not t["name"]:
                errors.append(f"tools[{i}].name must be a non-empty string")
            if not isinstance(t.get("description"), str) or not t["description"]:
                errors.append(f"tools[{i}].description must be a non-empty string")
            if not isinstance(t.get("parameters"), dict):
                errors.append(f"tools[{i}].parameters must be an object")

    context = entry.get("context")
    if not isinstance(context, list):
        errors.append("context must be an array")
    else:
        for i, c in enumerate(context):
            if isinstance(c, str):
                continue
            if not isinstance(c, dict):
                errors.append(f"context[{i}] must be a string or object")
                continue
            if not isinstance(c.get("content"), str):
                errors.append(f"context[{i}].content must be a string")

    expected = entry.get("expected")
    if not isinstance(expected, dict):
        errors.append("expected must be an object")
    else:
        allowed_expected = {"tool_calls", "json_valid", "refusal", "citations_required"}
        for k in expected.keys():
            if k not in allowed_expected:
                errors.append(f"expected has unknown key: {k}")

        tool_calls = expected.get("tool_calls")
        if not isinstance(tool_calls, list):
            errors.append("expected.tool_calls must be an array")
        else:
            for i, call in enumerate(tool_calls):
                if not isinstance(call, dict):
                    errors.append(f"expected.tool_calls[{i}] must be an object")
                    continue
                if not isinstance(call.get("name"), str) or not call["name"]:
                    errors.append(f"expected.tool_calls[{i}].name must be a non-empty string")
                if not isinstance(call.get("args"), dict):
                    errors.append(f"expected.tool_calls[{i}].args must be an object")

        for k in ("json_valid", "refusal", "citations_required"):
            if not isinstance(expected.get(k), bool):
                errors.append(f"expected.{k} must be a boolean")

    eph = entry.get("expected_prompt_hash")
    if eph is not None:
        if not isinstance(eph, str):
            errors.append("expected_prompt_hash must be a string when present")
        else:
            # strict sha256 hex: 64 hex chars
            if len(eph) != 64 or any(ch not in "0123456789abcdefABCDEF" for ch in eph):
                errors.append("expected_prompt_hash must be a 64-char sha256 hex string")

    # legacy consistency checks when both present
    if isinstance(expected, dict) and "expected_tool_calls" in entry and "tool_calls" in expected:
        if entry["expected_tool_calls"] != expected["tool_calls"]:
            errors.append("legacy expected_tool_calls must equal expected.tool_calls")

    if isinstance(expected, dict) and "expects_json" in entry and "json_valid" in expected:
        if entry["expects_json"] != expected["json_valid"]:
            errors.append("legacy expects_json must equal expected.json_valid")

    if isinstance(expected, dict) and "expects_refusal" in entry and "refusal" in expected:
        if entry["expects_refusal"] != expected["refusal"]:
            errors.append("legacy expects_refusal must equal expected.refusal")

    if isinstance(expected, dict) and "requires_citations" in entry and "citations_required" in expected:
        if entry["requires_citations"] != expected["citations_required"]:
            errors.append("legacy requires_citations must equal expected.citations_required")

    return errors


def _load_golden(path: Path) -> Dict[str, Any]:
    raw = _read_text(path)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse JSON at {path}: {e}") from e
    return _normalise_golden_payload(payload)


def _make_sarif(
    *,
    repo_root: Path,
    golden_path: Path,
    findings: List[Finding],
    started_at: str,
    finished_at: str,
) -> Dict[str, Any]:
    def _level(kind: str) -> str:
        # SARIF levels: "error" | "warning" | "note" | "none"
        return "error" if kind in ("schema", "hash") else "warning"

    artifact_uri = str(golden_path.as_posix())

    rules = [
        {
            "id": "PROMPT_SCHEMA",
            "name": "PromptSchemaContract",
            "shortDescription": {"text": "Golden prompt case must satisfy the schema contract"},
        },
        {
            "id": "PROMPT_HASH",
            "name": "PromptHashMismatch",
            "shortDescription": {"text": "Prompt hash regression detected"},
        },
    ]

    results = []
    for f in findings:
        rule_id = "PROMPT_SCHEMA" if f.kind == "schema" else "PROMPT_HASH"
        results.append(
            {
                "ruleId": rule_id,
                "level": _level(f.kind),
                "message": {"text": f"[{f.stable_id}] {f.message}"},
                "locations": [
                    {
                        "physicalLocation": {
                            "artifactLocation": {"uri": artifact_uri},
                            "region": {"startLine": 1, "startColumn": 1},
                        }
                    }
                ],
                "properties": {"stable_id": f.stable_id, "kind": f.kind},
            }
        )

    sarif = {
        "version": "2.1.0",
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "offLLM Prompt Regression",
                        "informationUri": "https://example.invalid/offllm/prompt-regression",
                        "rules": rules,
                    }
                },
                "invocations": [
                    {
                        "executionSuccessful": len(findings) == 0,
                        "startTimeUtc": started_at,
                        "endTimeUtc": finished_at,
                    }
                ],
                "results": results,
            }
        ],
    }
    return sarif


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)

    repo_root = Path(os.getcwd()).resolve()
    golden_path = Path(args.golden).resolve()
    report_out = Path(args.report_out).resolve()
    sarif_out = Path(args.sarif_out).resolve()

    started_at = _utc_now_iso()

    findings: List[Finding] = []
    cases_count = 0
    hash_checked = 0

    try:
        data = _load_golden(golden_path)
    except Exception as e:
        # Emit both reports even for load failures
        msg = str(e)
        findings.append(Finding(stable_id="__global__", kind="schema", message=msg, file=str(golden_path)))
        finished_at = _utc_now_iso()

        report = {
            "tool": "offLLM-prompt-regression",
            "started_at": started_at,
            "finished_at": finished_at,
            "ok": False,
            "golden_path": str(golden_path),
            "summary": {"cases": 0, "hash_checked": 0, "failures": 1},
            "failures": [
                {
                    "stable_id": "__global__",
                    "kind": "schema",
                    "message": msg,
                    "file": str(golden_path),
                }
            ],
        }
        _write_json(report_out, report)
        _write_json(
            sarif_out,
            _make_sarif(
                repo_root=repo_root,
                golden_path=golden_path,
                findings=findings,
                started_at=started_at,
                finished_at=finished_at,
            ),
        )
        return 1

    cases = data.get("cases", [])
    if not isinstance(cases, list):
        findings.append(
            Finding(
                stable_id="__global__",
                kind="schema",
                message="golden payload normalised but cases is not a list (unexpected)",
                file=str(golden_path),
            )
        )
        cases = []

    cases_count = len(cases)

    seen_ids: set[str] = set()

    for idx, entry in enumerate(cases):
        stable_id = f"__case_{idx}__"
        if not isinstance(entry, dict):
            findings.append(
                Finding(
                    stable_id=stable_id,
                    kind="schema",
                    message=f"case at index {idx} must be an object",
                    file=str(golden_path),
                )
            )
            continue

        if isinstance(entry.get("stable_id"), str):
            stable_id = entry["stable_id"]

        # uniqueness
        if stable_id in seen_ids:
            findings.append(
                Finding(
                    stable_id=stable_id,
                    kind="schema",
                    message="duplicate stable_id detected",
                    file=str(golden_path),
                )
            )
        seen_ids.add(stable_id)

        # schema validation
        schema_errors = _validate_case_schema(entry)
        for err in schema_errors:
            findings.append(Finding(stable_id=stable_id, kind="schema", message=err, file=str(golden_path)))

        # hash regression check
        expected_hash = entry.get("expected_prompt_hash")
        if expected_hash is None:
            if args.strict:
                findings.append(
                    Finding(
                        stable_id=stable_id,
                        kind="hash",
                        message="missing expected_prompt_hash (strict mode)",
                        file=str(golden_path),
                    )
                )
            continue

        # compute sha256 of user_prompt (or prompt)
        prompt_text = entry.get("user_prompt")
        if not isinstance(prompt_text, str):
            findings.append(
                Finding(
                    stable_id=stable_id,
                    kind="hash",
                    message="cannot compute hash because user_prompt is not a string",
                    file=str(golden_path),
                )
            )
            continue

        actual = _sha256_hex(prompt_text)
        hash_checked += 1
        if isinstance(expected_hash, str) and actual.lower() != expected_hash.lower():
            findings.append(
                Finding(
                    stable_id=stable_id,
                    kind="hash",
                    message=f"prompt hash mismatch: expected {expected_hash} got {actual}",
                    file=str(golden_path),
                )
            )

    finished_at = _utc_now_iso()
    ok = len(findings) == 0

    report = {
        "tool": "offLLM-prompt-regression",
        "started_at": started_at,
        "finished_at": finished_at,
        "ok": ok,
        "golden_path": str(golden_path),
        "summary": {
            "cases": cases_count,
            "hash_checked": hash_checked,
            "failures": len(findings),
        },
        "failures": [
            {
                "stable_id": f.stable_id,
                "kind": f.kind,
                "message": f.message,
                "file": f.file,
            }
            for f in findings
        ],
    }

    _write_json(report_out, report)
    _write_json(
        sarif_out,
        _make_sarif(
            repo_root=repo_root,
            golden_path=golden_path,
            findings=findings,
            started_at=started_at,
            finished_at=finished_at,
        ),
    )

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
