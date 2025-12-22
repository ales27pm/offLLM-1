#!/usr/bin/env python3
"""
Prompt Regression Runner
========================

Runs golden prompt regression tests against the current prompt registry.
Always emits:
- machine-readable JSON report
- SARIF report (even on crash)

Design goals:
- deterministic
- CI-safe
- strict on schema
- tolerant on prompt registry encoding (JSON or Python literal)
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List

# ----------------------------
# Regex for extracting registry
# ----------------------------

REGISTRY_RE = re.compile(
    r"PROMPT_REGISTRY\s*=\s*(\{.*?\})",
    re.DOTALL | re.MULTILINE,
)

# ----------------------------
# Utilities
# ----------------------------

def ensure_jsonable(obj: Any) -> Any:
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, (list, tuple)):
        return [ensure_jsonable(x) for x in obj]
    if isinstance(obj, dict):
        return {str(k): ensure_jsonable(v) for k, v in obj.items()}
    raise TypeError(f"Non-JSONable value in registry: {type(obj).__name__}")


def load_prompt_registry(template_path: str) -> Dict[str, Any]:
    text = Path(template_path).read_text(encoding="utf-8")
    match = REGISTRY_RE.search(text)
    if not match:
        raise ValueError(f"Prompt registry not found in template: {template_path}")

    raw = match.group(1).strip()

    # 1) Strict JSON (preferred)
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise TypeError("Prompt registry root must be an object/dict")
        return data
    except json.JSONDecodeError:
        pass

    # 2) Python literal fallback (SAFE)
    try:
        data = ast.literal_eval(raw)
    except Exception as e:
        raise ValueError(
            "Prompt registry is neither valid JSON nor valid Python literal"
        ) from e

    if not isinstance(data, dict):
        raise TypeError("Prompt registry root must be a dict")

    return ensure_jsonable(data)


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def write_sarif(path: Path, results: List[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sarif = {
        "version": "2.1.0",
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "prompt-regression",
                        "informationUri": "https://example.invalid",
                        "rules": [],
                    }
                },
                "results": results,
            }
        ],
    }
    write_json(path, sarif)


# ----------------------------
# Evaluation logic
# ----------------------------

def evaluate_registry(registry: Dict[str, Any]) -> Dict[str, Any]:
    """
    This function performs *structural* regression checks.

    NOTE:
    This does NOT run the model. That is intentional.
    Prompt regression is about *contract stability*:
      - shape
      - IDs
      - required fields
    """

    failures = []
    total = 0

    for prompt_id, entry in registry.items():
        total += 1

        if not isinstance(entry, dict):
            failures.append(f"{prompt_id}: entry must be an object")
            continue

        for required in ("id", "version", "template"):
            if required not in entry:
                failures.append(f"{prompt_id}: missing required field '{required}'")

        if "tools" in entry and not isinstance(entry["tools"], list):
            failures.append(f"{prompt_id}: 'tools' must be a list if present")

    return {
        "total_prompts": total,
        "failures": failures,
        "passed": len(failures) == 0,
    }


# ----------------------------
# CLI
# ----------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--template",
        default="offllm_symbiosis_advisor_v4.py",
        help="Template file containing PROMPT_REGISTRY",
    )
    p.add_argument(
        "--report-out",
        required=True,
        help="Path to JSON report output",
    )
    p.add_argument(
        "--sarif-out",
        required=True,
        help="Path to SARIF output",
    )
    return p.parse_args()


# ----------------------------
# Main
# ----------------------------

def main() -> None:
    args = parse_args()
    report_out = Path(args.report_out)
    sarif_out = Path(args.sarif_out)

    sarif_results: List[Dict[str, Any]] = []
    exit_code = 0

    try:
        registry = load_prompt_registry(args.template)
        report = evaluate_registry(registry)

        write_json(report_out, report)

        if not report["passed"]:
            exit_code = 1
            for msg in report["failures"]:
                sarif_results.append(
                    {
                        "ruleId": "prompt-regression/structure",
                        "level": "error",
                        "message": {"text": msg},
                        "locations": [
                            {
                                "physicalLocation": {
                                    "artifactLocation": {
                                        "uri": args.template
                                    }
                                }
                            }
                        ],
                    }
                )

    except Exception as e:
        exit_code = 1
        tb = "".join(traceback.format_exception(e))
        sarif_results.append(
            {
                "ruleId": "prompt-regression/crash",
                "level": "error",
                "message": {
                    "text": f"{type(e).__name__}: {e}\n{tb}"
                },
            }
        )
        raise

    finally:
        # Always emit SARIF
        write_sarif(sarif_out, sarif_results)

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
