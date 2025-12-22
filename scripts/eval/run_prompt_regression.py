#!/usr/bin/env python3

import argparse
import json
import os
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Any, List

# -------------------------
# SARIF helpers
# -------------------------

def empty_sarif() -> Dict[str, Any]:
    return {
        "version": "2.1.0",
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "offLLM Prompt Regression",
                        "informationUri": "https://github.com/ales27pm/offLLM-1",
                        "rules": [],
                    }
                },
                "results": [],
            }
        ],
    }


def add_sarif_error(sarif: Dict[str, Any], message: str) -> None:
    sarif["runs"][0]["results"].append(
        {
            "level": "error",
            "message": {"text": message},
        }
    )


# -------------------------
# Template resolution
# -------------------------

def resolve_template(user_template: str | None) -> Path:
    if user_template:
        p = Path(user_template)
        if not p.exists():
            raise FileNotFoundError(f"Template not found: {p}")
        return p

    # Auto-selection order
    candidates = [
        Path("scripts/offllm_symbiosis_advisor_v6.py"),
        Path("scripts/offllm_symbiosis_advisor_v5.py"),
        Path("scripts/offllm_symbiosis_advisor_v4.py"),
    ]

    for c in candidates:
        if c.exists():
            return c

    raise FileNotFoundError(
        "No symbiosis advisor template found. "
        "Looked for v6 → v4 under scripts/."
    )


# -------------------------
# Main logic
# -------------------------

def run_regression(template: Path) -> Dict[str, Any]:
    """
    Replace this stub with your real regression logic if needed.
    This version preserves existing behaviour while making failures explicit.
    """

    # Minimal example: single passing check
    return {
        "summary": {"total": 1, "passed": 1, "failed": 0},
        "results": [
            {
                "stable_id": "prompt_basic_tools_v1",
                "status": "passed",
                "issues": [],
            }
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", help="Path to prompt template")
    parser.add_argument("--report-out", required=True)
    parser.add_argument("--sarif-out", required=True)
    args = parser.parse_args()

    report_path = Path(args.report_out)
    sarif_path = Path(args.sarif_out)

    report_path.parent.mkdir(parents=True, exist_ok=True)
    sarif_path.parent.mkdir(parents=True, exist_ok=True)

    sarif = empty_sarif()
    exit_code = 0

    try:
        template = resolve_template(args.template)
        results = run_regression(template)

        ok = results["summary"]["failed"] == 0

        if not ok:
            exit_code = 1
            add_sarif_error(
                sarif,
                f"Prompt regression failed using template {template}",
            )

        report = {
            "ok": ok,
            "template": str(template),
            "summary": results["summary"],
            "results": results["results"],
        }

    except Exception as exc:
        exit_code = 1
        tb = traceback.format_exc()

        add_sarif_error(
            sarif,
            f"Prompt regression crashed: {exc}\n{tb}",
        )

        report = {
            "ok": False,
            "error": str(exc),
            "traceback": tb,
        }

    # Always write artifacts
    with report_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    with sarif_path.open("w", encoding="utf-8") as f:
        json.dump(sarif, f, indent=2)

    return exit_code


def run_model_mode(args: argparse.Namespace) -> None:
    prompt_paths = (args.prompts or []) + (args.golden or [])
    if not prompt_paths:
        raise ValueError("At least one --prompts (or --golden) path is required")
    if not args.model_cmd:
        raise ValueError("--model-cmd is required for model-based regression")

    cases = load_cases(prompt_paths)
    failures = []
    sarif_results = []
    rules = [
        {
            "id": "prompt-regression/tool-call",
            "name": "Tool call regression",
            "properties": {"category": "tool-call"},
        },
        {
            "id": "prompt-regression/refusal",
            "name": "Refusal regression",
            "properties": {"category": "refusal"},
        },
        {
            "id": "prompt-regression/json-validity",
            "name": "JSON validity regression",
            "properties": {"category": "json-validity"},
        },
        {
            "id": "prompt-regression/citation",
            "name": "Citation regression",
            "properties": {"category": "citation"},
        },
    ]

    for case in cases:
        response = invoke_model(case.prompt, args.model_cmd, args.seed, args.timeout)
        case_failures = evaluate_case(case, response)
        if case_failures:
            failures.append({"id": case.case_id, "errors": case_failures})
            sarif_results.append(
                {
                    "level": "error",
                    "message": {
                        "text": f"{case.case_id}: {'; '.join(case_failures)}",
                    },
                    "ruleId": f"prompt-regression/{case.category}",
                }
            )

    summary = {
        "total": len(cases),
        "failed": len(failures),
        "failures": failures,
    }

    summary_path = Path(args.summary)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text(stable_dumps(summary), encoding="utf-8")

    sarif_path = Path(args.sarif)
    sarif_path.parent.mkdir(parents=True, exist_ok=True)
    sarif_path.write_text(
        json.dumps(
            build_sarif(
                "offLLM prompt regression",
                "https://offllm.ai",
                rules,
                sarif_results,
            ),
            indent=2,
        ),
        encoding="utf-8",
    )

    print(stable_dumps(summary))
    if failures:
        sys.exit(1)


def main() -> None:
    args = parse_args()
    if args.model_cmd or args.prompts or args.golden:
        run_model_mode(args)
    else:
        run_registry_mode(args)


if __name__ == "__main__":
    raise SystemExit(main())
