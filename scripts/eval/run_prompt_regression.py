import argparse
import hashlib
import json
import os
import re
from dataclasses import dataclass
from typing import Any, Optional


@dataclass(frozen=True)
class ToolCall:
    name: str
    args: dict[str, Any]


REQUIRED_FIELDS = {
    "stable_id",
    "tools",
    "context",
    "user_prompt",
    "expected_response",
    "expected_tool_calls",
    "expects_json",
    "expects_refusal",
    "requires_citations",
}

RULE_METADATA = {
    "schema_invalid": "Golden prompt schema validation failed",
    "prompt_mismatch": "Prompt output mismatch",
    "model_response_missing": "Model response fixture missing",
    "unexpected_json": "Response was JSON when JSON was not expected",
    "invalid_json": "Response was not valid JSON",
    "tool_calls_parse_error": "Failed to parse tool calls",
    "tool_calls_mismatch": "Tool calls did not match expected",
    "refusal_missing": "Refusal expectation requires JSON response with refusal flag",
    "refusal_mismatch": "Refusal flag did not match expectation",
    "citations_missing": "Citations were required but missing",
    "citations_unexpected": "Citations were present when not expected",
}


def build_prompt(
    template: dict, tools: list[dict], context: list[dict], user_prompt: str
) -> str:
    tool_format = template["tool_format"]
    tools_sorted = sorted(tools, key=lambda t: t["name"])
    tools_desc = "\n".join(
        tool_format.format(
            name=tool["name"],
            description=tool["description"],
            parameters=json.dumps(
                tool.get("parameters", {}),
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        )
        for tool in tools_sorted
    )

    context_lines = []
    for entry in context:
        role = entry.get("role", "")
        content = entry.get("content", "")
        role_label = f"{role.capitalize()}:" if role else ""
        context_lines.append(f"{role_label} {content}".strip())

    sections = [
        template["system_intro"],
        tools_desc,
        template["instructions_title"],
        template["instructions"],
        template["context_title"],
        "\n".join(context_lines),
        f"{template['user_prefix']} {user_prompt}",
        template["assistant_prefix"],
    ]
    return "\n".join([segment for segment in sections if segment != ""])


def load_prompt_registry(registry_path: str) -> dict:
    with open(registry_path, "r", encoding="utf-8") as handle:
        text = handle.read()
    match = re.search(r"PROMPT_REGISTRY_JSON\\s*=\\s*`(.*?)`", text, re.S)
    if not match:
        raise ValueError("Unable to locate PROMPT_REGISTRY_JSON in registry file")
    return json.loads(match.group(1))


def get_runtime_template(registry: dict) -> dict:
    prompt = registry["prompts"].get("runtime_prompt_v1")
    if not prompt:
        raise ValueError("runtime_prompt_v1 missing from prompt registry")
    return prompt["template"]


def _scan_balanced(
    text: str, start: int, open_char: str, close_char: str, initial_depth: int = 0
) -> tuple[int, bool]:
    depth = initial_depth
    in_quote: Optional[str] = None
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if escaped:
            escaped = False
            continue
        if char == "\\":
            escaped = True
            continue
        if in_quote:
            if char == in_quote:
                in_quote = None
            continue
        if char in ('"', "'"):
            in_quote = char
            continue
        if char == open_char:
            depth += 1
        elif char == close_char:
            depth -= 1
            if depth == 0:
                return index, True
    return len(text), False


def _is_name_start(char: str) -> bool:
    return char.isalpha() or char == "_"


def _is_name_char(char: str) -> bool:
    return char.isalnum() or char in {"_", "-"}


def _parse_name(text: str, cursor: int) -> tuple[str, int]:
    if cursor >= len(text) or not _is_name_start(text[cursor]):
        raise ValueError("Malformed tool call: missing name")
    start = cursor
    cursor += 1
    while cursor < len(text) and _is_name_char(text[cursor]):
        cursor += 1
    return text[start:cursor], cursor


def _parse_number(token: str) -> Optional[Any]:
    try:
        if any(ch in token for ch in (".", "e", "E")):
            return float(token)
        return int(token)
    except ValueError:
        return None


def _parse_scalar(token: str) -> Any:
    lowered = token.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered == "null":
        return None
    number = _parse_number(token)
    if number is not None:
        return number
    return token


def _parse_args(args_str: str) -> dict[str, Any]:
    if not args_str:
        return {}

    args: dict[str, Any] = {}
    cursor = 0
    length = len(args_str)

    while cursor < length:
        while cursor < length and args_str[cursor] in {" ", "\t", "\n", ","}:
            cursor += 1
        if cursor >= length:
            break

        key, cursor = _parse_name(args_str, cursor)

        while cursor < length and args_str[cursor] in {" ", "\t", "\n"}:
            cursor += 1
        if cursor >= length or args_str[cursor] != "=":
            raise ValueError("Malformed argument string")
        cursor += 1
        while cursor < length and args_str[cursor] in {" ", "\t", "\n"}:
            cursor += 1
        if cursor >= length:
            raise ValueError("Malformed argument string")

        char = args_str[cursor]
        if char in {'"', "'"}:
            quote = char
            cursor += 1
            value_chars = []
            escaped = False
            closed = False
            while cursor < length:
                current = args_str[cursor]
                if escaped:
                    value_chars.append(current)
                    escaped = False
                    cursor += 1
                    continue
                if current == "\\":
                    escaped = True
                    cursor += 1
                    continue
                if current == quote:
                    cursor += 1
                    closed = True
                    break
                value_chars.append(current)
                cursor += 1
            if escaped or not closed:
                raise ValueError("Malformed argument string")
            value: Any = _parse_scalar("".join(value_chars))
        elif char in {"{", "["}:
            open_char = char
            close_char = "}" if char == "{" else "]"
            start = cursor
            end, closed = _scan_balanced(args_str, cursor, open_char, close_char, 0)
            if not closed:
                raise ValueError("Malformed argument string")
            raw = args_str[start : end + 1]
            try:
                value = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError("Malformed argument string") from exc
            cursor = end + 1
        else:
            start = cursor
            while cursor < length and args_str[cursor] not in {" ", "\t", "\n", ","}:
                cursor += 1
            token = args_str[start:cursor].strip()
            if not token:
                raise ValueError("Malformed argument string")
            value = _parse_scalar(token)

        args[key] = value

    return args


def parse_tool_calls(response: str) -> list[ToolCall]:
    calls: list[ToolCall] = []
    marker = "TOOL_CALL:"
    cursor = 0
    while True:
        index = response.find(marker, cursor)
        if index == -1:
            break
        cursor = index + len(marker)
        while cursor < len(response) and response[cursor].isspace():
            cursor += 1
        name, cursor = _parse_name(response, cursor)
        while cursor < len(response) and response[cursor].isspace():
            cursor += 1
        if cursor >= len(response) or response[cursor] != "(":
            raise ValueError(f"Malformed TOOL_CALL for {name}: missing '('")
        cursor += 1
        args_start = cursor
        end, closed = _scan_balanced(response, cursor, "(", ")", 1)
        if not closed:
            raise ValueError(f"Malformed TOOL_CALL for {name}: unterminated args")
        args_str = response[args_start:end].strip()
        args = _parse_args(args_str)
        calls.append(ToolCall(name=name, args=args))
        cursor = end + 1
    return calls


def contains_markdown_citation(text: str) -> bool:
    cursor = 0
    while cursor < len(text):
        start = text.find("[", cursor)
        if start == -1:
            return False
        middle = text.find("](", start)
        if middle == -1:
            cursor = start + 1
            continue
        end = text.find(")", middle + 2)
        if end == -1:
            cursor = middle + 2
            continue
        if middle > start + 1 and end > middle + 2:
            return True
        cursor = end + 1
    return False


def normalize_tool_calls(calls: list[ToolCall]) -> list[dict[str, Any]]:
    return [{"name": call.name, "args": call.args} for call in calls]


def validate_entry_schema(entry: dict) -> list[str]:
    errors = []
    extra = set(entry.keys()) - REQUIRED_FIELDS - {"expected_prompt", "expected_prompt_hash"}
    missing = REQUIRED_FIELDS - set(entry.keys())
    if extra:
        errors.append(f"Unexpected fields: {sorted(extra)}")
    if missing:
        errors.append(f"Missing fields: {sorted(missing)}")
    if "expected_prompt" not in entry and "expected_prompt_hash" not in entry:
        errors.append("expected_prompt or expected_prompt_hash must be provided")

    if not isinstance(entry.get("stable_id"), str) or not entry.get("stable_id"):
        errors.append("stable_id must be a non-empty string")
    if not isinstance(entry.get("tools"), list):
        errors.append("tools must be a list")
    if not isinstance(entry.get("context"), list):
        errors.append("context must be a list")
    if not isinstance(entry.get("user_prompt"), str):
        errors.append("user_prompt must be a string")
    if "expected_prompt" in entry and not isinstance(entry.get("expected_prompt"), str):
        errors.append("expected_prompt must be a string")
    if "expected_prompt_hash" in entry and not isinstance(
        entry.get("expected_prompt_hash"), str
    ):
        errors.append("expected_prompt_hash must be a string")
    if not isinstance(entry.get("expected_response"), str):
        errors.append("expected_response must be a string")
    if not isinstance(entry.get("expected_tool_calls"), list):
        errors.append("expected_tool_calls must be a list")
    if not isinstance(entry.get("expects_json"), bool):
        errors.append("expects_json must be a bool")
    if not isinstance(entry.get("expects_refusal"), bool):
        errors.append("expects_refusal must be a bool")
    if not isinstance(entry.get("requires_citations"), bool):
        errors.append("requires_citations must be a bool")

    if errors:
        return errors

    for idx, call in enumerate(entry["expected_tool_calls"]):
        if not isinstance(call, dict):
            errors.append(f"expected_tool_calls[{idx}] must be an object")
            continue
        if "name" not in call or "args" not in call:
            errors.append(f"expected_tool_calls[{idx}] must include name and args")
            continue
        if not isinstance(call["name"], str) or not call["name"]:
            errors.append(
                f"expected_tool_calls[{idx}].name must be a non-empty string"
            )
        if not isinstance(call["args"], dict):
            errors.append(f"expected_tool_calls[{idx}].args must be an object")

    return errors


def invoke_model(entry: dict, prompt: str) -> str:
    _ = prompt
    response = entry.get("expected_response")
    if not response:
        raise ValueError("Model response fixture missing")
    return response


def parse_json_response(response: str) -> Any:
    return json.loads(response)


def find_line_number(path: str, stable_id: str) -> int:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for line_number, line in enumerate(handle, start=1):
                if stable_id in line:
                    return line_number
    except OSError:
        return 1
    return 1


def build_sarif(
    failures: list[dict[str, Any]], golden_path: str
) -> dict[str, Any]:
    rules = []
    rule_ids = sorted({issue["code"] for issue in failures})
    for rule_id in rule_ids:
        rules.append(
            {
                "id": rule_id,
                "name": rule_id,
                "shortDescription": {"text": RULE_METADATA.get(rule_id, rule_id)},
            }
        )

    results = []
    for issue in failures:
        stable_id = issue["stable_id"]
        line_number = find_line_number(golden_path, stable_id)
        results.append(
            {
                "ruleId": issue["code"],
                "level": "error",
                "message": {"text": issue["message"]},
                "locations": [
                    {
                        "physicalLocation": {
                            "artifactLocation": {"uri": golden_path},
                            "region": {"startLine": line_number},
                        }
                    }
                ],
                "properties": {
                    "stable_id": stable_id,
                    "prompt_hash": issue.get("prompt_hash"),
                },
            }
        )

    return {
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "version": "2.1.0",
        "runs": [
            {
                "tool": {"driver": {"name": "prompt-regression", "rules": rules}},
                "results": results,
            }
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run prompt regression tests.")
    parser.add_argument(
        "--template",
        default=os.path.join(
            os.path.dirname(__file__),
            "..",
            "..",
            "src",
            "core",
            "prompt",
            "PromptRegistry.ts",
        ),
    )
    parser.add_argument(
        "--golden",
        default=os.path.join(os.path.dirname(__file__), "golden_prompts.json"),
    )
    parser.add_argument(
        "--report-out",
        default="",
        help="Optional path for machine-readable JSON output.",
    )
    parser.add_argument(
        "--sarif-out",
        default="prompt_regression.sarif",
        help="Path to write SARIF output.",
    )
    args = parser.parse_args()

    registry = load_prompt_registry(args.template)
    template = get_runtime_template(registry)
    with open(args.golden, "r", encoding="utf-8") as handle:
        golden = json.load(handle)

    failures: list[dict[str, Any]] = []
    results: list[dict[str, Any]] = []
    seen_ids: set[str] = set()

    for index, entry in enumerate(golden):
        issues: list[dict[str, Any]] = []
        schema_errors = validate_entry_schema(entry)
        stable_id = entry.get("stable_id", f"entry_{index}")
        if stable_id in seen_ids:
            schema_errors.append("stable_id must be unique")
        seen_ids.add(stable_id)

        if schema_errors:
            for error in schema_errors:
                issues.append(
                    {
                        "code": "schema_invalid",
                        "message": error,
                    }
                )
            results.append(
                {
                    "stable_id": stable_id,
                    "status": "failed",
                    "issues": issues,
                }
            )
            continue

        prompt = build_prompt(
            template,
            entry.get("tools", []),
            entry.get("context", []),
            entry.get("user_prompt", ""),
        )
        prompt_hash = hashlib.sha256(prompt.encode("utf-8")).hexdigest()

        expected_prompt = entry.get("expected_prompt")
        expected_prompt_hash = entry.get("expected_prompt_hash")
        if expected_prompt is not None and prompt != expected_prompt:
            issues.append(
                {
                    "code": "prompt_mismatch",
                    "message": "Prompt did not match expected output",
                    "prompt_hash": prompt_hash,
                }
            )
        elif expected_prompt_hash is not None and prompt_hash != expected_prompt_hash:
            issues.append(
                {
                    "code": "prompt_mismatch",
                    "message": "Prompt hash did not match expected output",
                    "prompt_hash": prompt_hash,
                }
            )

        try:
            response = invoke_model(entry, prompt)
        except ValueError as error:
            issues.append(
                {
                    "code": "model_response_missing",
                    "message": str(error),
                    "prompt_hash": prompt_hash,
                }
            )
            response = ""

        response_json: Any = None
        parsed_json = False
        if response:
            try:
                response_json = parse_json_response(response)
                parsed_json = True
            except json.JSONDecodeError:
                parsed_json = False

        if entry["expects_json"]:
            if not parsed_json:
                issues.append(
                    {
                        "code": "invalid_json",
                        "message": "Response was not valid JSON",
                        "prompt_hash": prompt_hash,
                    }
                )
        else:
            if parsed_json:
                issues.append(
                    {
                        "code": "unexpected_json",
                        "message": "Response was JSON but JSON was not expected",
                        "prompt_hash": prompt_hash,
                    }
                )

        try:
            if parsed_json and isinstance(response_json, dict) and "tool_calls" in response_json:
                tool_calls_raw = response_json.get("tool_calls")
                if not isinstance(tool_calls_raw, list):
                    raise ValueError("tool_calls must be a list")
                parsed_calls = []
                for call in tool_calls_raw:
                    if not isinstance(call, dict):
                        raise ValueError("tool_calls entries must be objects")
                    name = call.get("name")
                    args = call.get("args")
                    if not isinstance(name, str) or not name:
                        raise ValueError("tool_calls entries must include name")
                    if not isinstance(args, dict):
                        raise ValueError("tool_calls entries must include args")
                    parsed_calls.append(ToolCall(name=name, args=args))
            else:
                parsed_calls = parse_tool_calls(response)
            actual_tool_calls = normalize_tool_calls(parsed_calls)
        except Exception as error:
            issues.append(
                {
                    "code": "tool_calls_parse_error",
                    "message": f"{error}",
                    "prompt_hash": prompt_hash,
                }
            )
            actual_tool_calls = []

        if actual_tool_calls != entry["expected_tool_calls"]:
            issues.append(
                {
                    "code": "tool_calls_mismatch",
                    "message": "Tool calls did not match expected",
                    "prompt_hash": prompt_hash,
                }
            )

        if entry["expects_refusal"]:
            if not parsed_json or not isinstance(response_json, dict):
                issues.append(
                    {
                        "code": "refusal_missing",
                        "message": "Refusal checks require JSON response with refusal field",
                        "prompt_hash": prompt_hash,
                    }
                )
            else:
                refusal_value = response_json.get("refusal")
                if not isinstance(refusal_value, bool):
                    issues.append(
                        {
                            "code": "refusal_missing",
                            "message": "Refusal field missing or not boolean",
                            "prompt_hash": prompt_hash,
                        }
                    )
                elif refusal_value is not entry["expects_refusal"]:
                    issues.append(
                        {
                            "code": "refusal_mismatch",
                            "message": "Refusal flag did not match expected",
                            "prompt_hash": prompt_hash,
                        }
                    )
        else:
            if parsed_json and isinstance(response_json, dict) and isinstance(
                response_json.get("refusal"), bool
            ):
                if response_json.get("refusal"):
                    issues.append(
                        {
                            "code": "refusal_mismatch",
                            "message": "Response was refusal but refusal not expected",
                            "prompt_hash": prompt_hash,
                        }
                    )

        if entry["requires_citations"]:
            has_citations = False
            if parsed_json and isinstance(response_json, dict):
                citations = response_json.get("citations")
                if isinstance(citations, list):
                    has_citations = len(citations) > 0
            if not has_citations:
                has_citations = contains_markdown_citation(response)
            if not has_citations:
                issues.append(
                    {
                        "code": "citations_missing",
                        "message": "Citations required but not found",
                        "prompt_hash": prompt_hash,
                    }
                )
        else:
            has_citations = False
            if parsed_json and isinstance(response_json, dict):
                citations = response_json.get("citations")
                if isinstance(citations, list) and citations:
                    has_citations = True
            if not has_citations:
                has_citations = contains_markdown_citation(response)
            if has_citations:
                issues.append(
                    {
                        "code": "citations_unexpected",
                        "message": "Citations were present but not expected",
                        "prompt_hash": prompt_hash,
                    }
                )

        status = "failed" if issues else "passed"
        results.append(
            {
                "stable_id": stable_id,
                "status": status,
                "issues": issues,
            }
        )
        for issue in issues:
            failures.append(
                {
                    "stable_id": stable_id,
                    "code": issue["code"],
                    "message": issue["message"],
                    "prompt_hash": issue.get("prompt_hash"),
                }
            )

    summary = {
        "total": len(results),
        "passed": sum(result["status"] == "passed" for result in results),
        "failed": sum(result["status"] == "failed" for result in results),
    }

    report = {"summary": summary, "results": results}
    output = json.dumps(report, indent=2)
    print(output)

    if args.report_out:
        report_dir = os.path.dirname(args.report_out)
        if report_dir:
            os.makedirs(report_dir, exist_ok=True)
        with open(args.report_out, "w", encoding="utf-8") as handle:
            handle.write(output)

    sarif_output = build_sarif(failures, args.golden)
    os.makedirs(os.path.dirname(args.sarif_out) or ".", exist_ok=True)
    with open(args.sarif_out, "w", encoding="utf-8") as handle:
        json.dump(sarif_output, handle, indent=2)

    if failures:
        raise SystemExit(
            f"Prompt regression failed for: {', '.join(sorted(set(f['stable_id'] for f in failures)))}"
        )


if __name__ == "__main__":
    main()
