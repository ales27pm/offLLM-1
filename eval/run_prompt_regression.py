import argparse
import json
import os
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, Iterable


REFUSAL_PATTERN = re.compile(
    r"\b(can't|cannot|won't|unable to|not able to|refuse|decline)\b",
    re.IGNORECASE,
)
CITATION_PATTERN = re.compile(r"\[\d+\]")


@dataclass
class PromptCase:
    case_id: str
    prompt: str
    expected: dict


def stable_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def load_cases(paths: Iterable[str]) -> list[PromptCase]:
    cases: list[PromptCase] = []
    allowed_top = {"id", "prompt", "expected"}
    allowed_expected = {
        "tool_calls",
        "json_valid",
        "refusal",
        "citations_required",
    }
    for path in paths:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, list):
            raise ValueError(f"Prompt suite must be a list: {path}")
        for entry in data:
            if not isinstance(entry, dict):
                raise ValueError(f"Prompt entry must be object: {entry}")
            unknown = set(entry.keys()) - allowed_top
            if unknown:
                raise ValueError(f"Unknown fields in prompt entry: {sorted(unknown)}")
            expected = entry.get("expected")
            if not isinstance(expected, dict):
                raise ValueError("Expected field must be an object")
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
            cases.append(
                PromptCase(
                    case_id=str(entry.get("id")),
                    prompt=str(entry.get("prompt")),
                    expected=expected,
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
                    break
                value += ch
                cursor += 1
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


def build_sarif(results: list[dict]) -> dict:
    return {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "offLLM prompt regression",
                        "informationUri": "https://offllm.ai",
                    }
                },
                "results": results,
            }
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run prompt regression suite.")
    parser.add_argument("--prompts", action="append", required=True)
    parser.add_argument("--model-cmd", required=True)
    parser.add_argument("--seed", default=None)
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--summary", default="eval/prompt_regression_summary.json")
    parser.add_argument("--sarif", default="eval/prompt_regression.sarif")
    args = parser.parse_args()

    cases = load_cases(args.prompts)
    failures = []
    sarif_results = []
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
                    "ruleId": "prompt-regression",
                }
            )

    summary = {
        "total": len(cases),
        "failed": len(failures),
        "failures": failures,
    }

    with open(args.summary, "w", encoding="utf-8") as handle:
        handle.write(stable_dumps(summary))

    with open(args.sarif, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(build_sarif(sarif_results), indent=2))

    print(stable_dumps(summary))
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
