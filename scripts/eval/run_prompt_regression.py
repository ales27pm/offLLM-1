#!/usr/bin/env python3
"""
Prompt Regression Runner
========================

Runs prompt regression checks in two modes:

1) Registry structural checks (default)
   Validates prompt registry shape and emits JSON + SARIF reports.

2) Golden prompt evaluation (model-based)
   Runs prompts through a deterministic model command and validates
   tool-call parsing, JSON validity, refusal detection, and citations.

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
import shlex
import subprocess
import sys
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List

# ----------------------------
# Regex for extracting registry
# ----------------------------

REGISTRY_RE = re.compile(
    r"PROMPT_REGISTRY\s*=\s*(\{.*?\})",
    re.DOTALL | re.MULTILINE,
)

REGISTRY_JSON_RE = re.compile(
    r"PROMPT_REGISTRY_JSON\s*=\s*`(.*?)`",
    re.DOTALL | re.MULTILINE,
)

REFUSAL_PATTERN = re.compile(
    r"\b(can't|cannot|won't|unable to|not able to|refuse|decline)\b",
    re.IGNORECASE,
)
CITATION_PATTERN = re.compile(r"\[\d+\]")

# ----------------------------
# Data structures
# ----------------------------


@dataclass
class PromptCase:
    case_id: str
    prompt: str
    expected: dict
    category: str


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


def stable_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def load_prompt_registry(template_path: str) -> Dict[str, Any]:
    template_file = Path(template_path)
    if template_file.suffix == ".json":
        data = json.loads(template_file.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise TypeError("Prompt registry root must be an object/dict")
        registry_root = data.get("prompts", data)
        if not isinstance(registry_root, dict):
            raise TypeError("Prompt registry root must be an object/dict")
        return ensure_jsonable(registry_root)

    text = template_file.read_text(encoding="utf-8")
    match = REGISTRY_RE.search(text)
    json_match = REGISTRY_JSON_RE.search(text)
    if not match and not json_match:
        raise ValueError(
            "Prompt registry not found in template: "
            f"{template_path} (expected PROMPT_REGISTRY or PROMPT_REGISTRY_JSON)"
        )

    if json_match:
        raw = json_match.group(1).strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            unescaped = raw.encode("utf-8").decode("unicode_escape")
            data = json.loads(unescaped)
        if not isinstance(data, dict):
            raise TypeError("Prompt registry root must be an object/dict")
        registry_root = data.get("prompts", data)
        if not isinstance(registry_root, dict):
            raise TypeError("Prompt registry root must be an object/dict")
        return registry_root

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

    registry_root = data.get("prompts", data)
    if not isinstance(registry_root, dict):
        raise TypeError("Prompt registry root must be a dict")

    return ensure_jsonable(registry_root)


def write_json(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(obj, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def build_sarif(
    tool_name: str,
    info_uri: str,
    rules: List[Dict[str, Any]],
    results: List[Dict[str, Any]],
) -> Dict[str, Any]:
    return {
        "version": "2.1.0",
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": tool_name,
                        "informationUri": info_uri,
                        "rules": rules,
                    }
                },
                "results": results,
            }
        ],
    }


def write_sarif(path: Path, sarif: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json(path, sarif)


# ----------------------------
# Registry evaluation logic
# ----------------------------


def evaluate_registry(registry: Dict[str, Any], registry_root: Path) -> Dict[str, Any]:
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

        for required in ("id", "version", "template_file"):
            if required not in entry:
                failures.append(f"{prompt_id}: missing required field '{required}'")
        template_file = entry.get("template_file")
        if template_file:
            template_path = registry_root / template_file
            if not template_path.is_file():
                failures.append(
                    f"{prompt_id}: template file not found at {template_path}"
                )

        if "tools" in entry and not isinstance(entry["tools"], list):
            failures.append(f"{prompt_id}: 'tools' must be a list if present")

    return {
        "total_prompts": total,
        "failures": failures,
        "passed": len(failures) == 0,
    }


# ----------------------------
# Golden prompt evaluation logic
# ----------------------------


def normalize_expected(entry: dict) -> dict:
    expected = entry.get("expected")
    if expected is None:
        expected = {}
    if not isinstance(expected, dict):
        raise ValueError("Expected field must be an object")

    if "expected_tool_calls" in entry and "tool_calls" not in expected:
        expected["tool_calls"] = entry.get("expected_tool_calls")

    if "expects_json" in entry and "json_valid" not in expected:
        expected["json_valid"] = entry.get("expects_json")

    if "expects_refusal" in entry and "refusal" not in expected:
        expected["refusal"] = entry.get("expects_refusal")

    if "requires_citations" in entry and "citations_required" not in expected:
        expected["citations_required"] = entry.get("requires_citations")

    expected.setdefault("tool_calls", [])
    expected.setdefault("json_valid", False)
    expected.setdefault("refusal", False)
    expected.setdefault("citations_required", False)
    return expected


def load_cases(paths: Iterable[str]) -> list[PromptCase]:
    cases: list[PromptCase] = []
    allowed_expected = {
        "tool_calls",
        "json_valid",
        "refusal",
        "citations_required",
    }
    valid_categories = {"tool-call", "refusal", "json-validity", "citation"}
    for path in paths:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, list):
            raise ValueError(f"Prompt suite must be a list: {path}")
        for entry in data:
            if not isinstance(entry, dict):
                raise ValueError(f"Prompt entry must be object: {entry}")
            expected = normalize_expected(entry)
            expected_unknown = set(expected.keys()) - allowed_expected
            if expected_unknown:
                raise ValueError(
                    f"Unknown fields in expected: {sorted(expected_unknown)}"
                )
            tool_calls = expected.get("tool_calls", [])
            if not isinstance(tool_calls, list):
                raise ValueError("expected.tool_calls must be a list")
            for call in tool_calls:
                if not isinstance(call, dict):
                    raise ValueError("tool_calls entries must be objects")
                if set(call.keys()) != {"name", "args"}:
                    raise ValueError("tool_calls entries require name and args only")

            case_id = entry.get("stable_id") or entry.get("id")
            if not case_id:
                raise ValueError("Prompt entry must include stable_id or id")
            prompt = entry.get("prompt")
            if prompt is None:
                prompt = entry.get("user_prompt")
            if prompt is None:
                raise ValueError("Prompt entry must include prompt or user_prompt")
            category = entry.get("sarif_category")
            if not category or category not in valid_categories:
                raise ValueError(
                    f"Prompt entry must include valid sarif_category: {valid_categories}"
                )
            cases.append(
                PromptCase(
                    case_id=str(case_id),
                    prompt=str(prompt),
                    expected=expected,
                    category=str(category),
                )
            )
    return cases


def invoke_model(prompt: str, command: str, seed: str | None, timeout_s: int) -> str:
    env = os.environ.copy()
    env["OFFLLM_DETERMINISTIC"] = "1"
    env["TEMPERATURE"] = "0"
    if seed:
        env["OFFLLM_SEED"] = seed
    if not command or not command.strip():
        raise ValueError("model command must be a non-empty string")
    if re.search(r"[;&|><`]", command):
        raise ValueError("model command contains unsupported shell metacharacters")
    cmd = shlex.split(command)
    if not cmd:
        raise ValueError("model command must contain an executable")
    for arg in cmd:
        if not re.fullmatch(r"[A-Za-z0-9_./:=+-]+", arg):
            raise ValueError(f"model command contains unsafe token: {arg!r}")
    try:
        result = subprocess.run(
            cmd,
            input=prompt,
            text=True,
            capture_output=True,
            env=env,
            check=False,
            timeout=timeout_s,
            shell=False,
        )
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"Model command timed out after {timeout_s}s") from error
    if result.returncode != 0:
        raise RuntimeError(
            f"Model command failed: {result.returncode}\n{result.stderr.strip()}"
        )
    return result.stdout.strip()


def scan_balanced(text: str, start: int, open_char: str, close_char: str) -> int:
    depth = 0
    escaped = False
    in_quote: str | None = None
    for i in range(start, len(text)):
        ch = text[i]
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if in_quote:
            if ch == in_quote:
                in_quote = None
            continue
        if ch in ("\"", "'"):
            in_quote = ch
            continue
        if ch == open_char:
            depth += 1
        elif ch == close_char:
            depth -= 1
            if depth == 0:
                return i
    return -1


def coerce_value(raw: str) -> Any:
    if raw == "true":
        return True
    if raw == "false":
        return False
    try:
        candidate = raw.strip()
        if candidate and re.fullmatch(r"[-+]?\d+(?:\.\d+)?", candidate):
            return float(candidate) if "." in candidate else int(candidate)
    except ValueError:
        pass
    if raw.strip().startswith("{") or raw.strip().startswith("["):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw
    return raw


def parse_args_str(arg_str: str) -> dict:
    if not arg_str.strip():
        return {}
    args: dict[str, Any] = {}
    cursor = 0
    length = len(arg_str)
    while cursor < length:
        while cursor < length and arg_str[cursor] in " \n\t,":
            cursor += 1
        if cursor >= length:
            break
        key_match = re.match(r"[A-Za-z_][\w-]*", arg_str[cursor:])
        if not key_match:
            raise ValueError("Malformed argument string")
        key = key_match.group(0)
        cursor += len(key)
        while cursor < length and arg_str[cursor].isspace():
            cursor += 1
        if cursor >= length or arg_str[cursor] != "=":
            raise ValueError("Malformed argument string")
        cursor += 1
        while cursor < length and arg_str[cursor].isspace():
            cursor += 1
        if cursor >= length:
            raise ValueError("Malformed argument string")
        char = arg_str[cursor]
        if char in ('"', "'"):
            quote = char
            cursor += 1
            value = ""
            escaped = False
            closed = False
            while cursor < length:
                ch = arg_str[cursor]
                if escaped:
                    value += ch
                    escaped = False
                    cursor += 1
                    continue
                if ch == "\\":
                    escaped = True
                    cursor += 1
                    continue
                if ch == quote:
                    cursor += 1
                    closed = True
                    break
                value += ch
                cursor += 1
            if not closed:
                raise ValueError("Malformed argument string")
            args[key] = coerce_value(value)
        elif char in ("{", "["):
            end_char = "}" if char == "{" else "]"
            end_index = scan_balanced(arg_str, cursor, char, end_char)
            if end_index == -1:
                raise ValueError("Malformed argument string")
            raw = arg_str[cursor : end_index + 1]
            try:
                args[key] = json.loads(raw)
            except json.JSONDecodeError:
                args[key] = raw
            cursor = end_index + 1
        else:
            start = cursor
            while cursor < length and arg_str[cursor] not in " \n\t,":
                cursor += 1
            args[key] = coerce_value(arg_str[start:cursor])
    return args


def parse_tool_calls(response: str) -> list[dict]:
    results: list[dict] = []
    marker = re.compile(r"TOOL_CALL:")
    for match in marker.finditer(response):
        cursor = match.end()
        while cursor < len(response) and response[cursor].isspace():
            cursor += 1
        name_match = re.match(r"[A-Za-z_][\w-]*", response[cursor:])
        if not name_match:
            continue
        name = name_match.group(0)
        cursor += len(name)
        while cursor < len(response) and response[cursor].isspace():
            cursor += 1
        if cursor >= len(response) or response[cursor] != "(":
            continue
        end_index = scan_balanced(response, cursor, "(", ")")
        if end_index == -1:
            continue
        arg_str = response[cursor + 1 : end_index]
        args = parse_args_str(arg_str.strip())
        results.append({"name": name, "args": args})
    return results


def check_tool_calls(expected: dict, response: str) -> list[str]:
    tool_calls_expected = expected.get("tool_calls", [])
    tool_calls_actual = parse_tool_calls(response)
    if tool_calls_expected != tool_calls_actual:
        return [
            "Tool call mismatch: expected "
            f"{stable_dumps(tool_calls_expected)} got "
            f"{stable_dumps(tool_calls_actual)}"
        ]
    return []


def check_json_valid(expected: dict, response: str) -> list[str]:
    json_valid_expected = expected.get("json_valid", False)
    try:
        json.loads(response)
        json_valid_actual = True
    except json.JSONDecodeError:
        json_valid_actual = False
    if json_valid_expected != json_valid_actual:
        return [
            f"JSON validity mismatch: expected {json_valid_expected} got {json_valid_actual}"
        ]
    return []


def check_refusal(expected: dict, response: str) -> list[str]:
    refusal_expected = expected.get("refusal", False)
    refusal_actual = bool(REFUSAL_PATTERN.search(response))
    if refusal_expected != refusal_actual:
        return [
            f"Refusal detection mismatch: expected {refusal_expected} got {refusal_actual}"
        ]
    return []


def check_citations(expected: dict, response: str) -> list[str]:
    citations_required = expected.get("citations_required", False)
    citations_present = bool(CITATION_PATTERN.search(response))
    if citations_required and not citations_present:
        return ["Citations required but none found"]
    if not citations_required and citations_present:
        return ["Citations not expected but found"]
    return []


def evaluate_case(case: PromptCase, response: str) -> list[str]:
    expected = case.expected
    failures: list[str] = []
    failures.extend(check_tool_calls(expected, response))
    failures.extend(check_json_valid(expected, response))
    failures.extend(check_refusal(expected, response))
    failures.extend(check_citations(expected, response))
    return failures


# ----------------------------
# CLI
# ----------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run prompt regression suite.")
    p.add_argument(
        "--template",
        default="prompts/registry.json",
        help="Template file containing the prompt registry",
    )
    p.add_argument(
        "--report-out",
        help="Path to JSON report output (registry mode)",
    )
    p.add_argument(
        "--sarif-out",
        help="Path to SARIF output (registry mode)",
    )
    p.add_argument("--prompts", action="append", help="Prompt suite JSON path")
    p.add_argument("--golden", action="append", help="Alias for --prompts")
    p.add_argument("--model-cmd", help="Deterministic model command")
    p.add_argument("--seed", default=None)
    p.add_argument("--timeout", type=int, default=60)
    p.add_argument("--summary", default="eval/prompt_regression_summary.json")
    p.add_argument("--sarif", default="eval/prompt_regression.sarif")
    return p.parse_args()


# ----------------------------
# Main
# ----------------------------


def run_registry_mode(args: argparse.Namespace) -> None:
    if not args.report_out or not args.sarif_out:
        raise ValueError("--report-out and --sarif-out are required in registry mode")
    report_out = Path(args.report_out)
    sarif_out = Path(args.sarif_out)

    sarif_results: List[Dict[str, Any]] = []
    exit_code = 0

    try:
        registry = load_prompt_registry(args.template)
        report = evaluate_registry(registry, Path(args.template).parent)

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
        raise

    finally:
        # Always emit SARIF
        write_sarif(
            sarif_out,
            build_sarif(
                "prompt-regression",
                "https://example.invalid",
                [
                    {
                        "id": "prompt-regression/structure",
                        "name": "Prompt registry structure",
                        "properties": {"category": "structure"},
                    },
                    {
                        "id": "prompt-regression/crash",
                        "name": "Prompt registry crash",
                        "properties": {"category": "crash"},
                    },
                ],
                sarif_results,
            ),
        )

    sys.exit(exit_code)


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
    main()
