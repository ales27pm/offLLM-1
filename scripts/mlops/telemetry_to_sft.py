import argparse
import json
import os
import re
from collections import defaultdict
from pathlib import Path
from typing import Any


EMAIL_PATTERN = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.IGNORECASE)
PHONE_PATTERN = re.compile(r"\+?\d[\d\s().-]{7,}\d")
TOKEN_PATTERN = re.compile(r"\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b")
SECRET_PATTERN = re.compile(r"\b(?:api|key|secret|token)[-_]?[A-Za-z0-9]{8,}\b", re.IGNORECASE)
BEARER_PATTERN = re.compile(r"\bBearer\s+[A-Za-z0-9._-]+\b")
SENSITIVE_KEY_PATTERN = re.compile(r"(token|secret|password|auth|api[_-]?key|session)", re.IGNORECASE)
MAX_VALUE_LENGTH = 2000


def redact_string(value: str) -> str:
    result = EMAIL_PATTERN.sub("[REDACTED_EMAIL]", value)
    result = PHONE_PATTERN.sub("[REDACTED_PHONE]", result)
    result = BEARER_PATTERN.sub("Bearer [REDACTED]", result)
    result = TOKEN_PATTERN.sub("[REDACTED_TOKEN]", result)
    result = SECRET_PATTERN.sub("[REDACTED_SECRET]", result)
    if len(result) > MAX_VALUE_LENGTH:
        result = f"{result[:MAX_VALUE_LENGTH]}…[TRUNCATED]"
    return result


def redact_value(value: Any) -> Any:
    if value is None:
        return value
    if isinstance(value, str):
        return redact_string(value)
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, dict):
        redacted = {}
        for key, entry in value.items():
            if SENSITIVE_KEY_PATTERN.search(str(key)):
                redacted[key] = "[REDACTED]"
            else:
                redacted[key] = redact_value(entry)
        return redacted
    return redact_string(str(value))


def stable_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def load_tool_schema(path: str) -> str:
    if not path:
        return ""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Tool schema not found: {path}")
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read().strip()


def parse_events(path: Path) -> dict:
    grouped = defaultdict(lambda: {"tool_calls": []})
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            event = json.loads(line)
            event_type = event.get("event_type")
            if not event_type:
                raise ValueError("Telemetry event missing event_type")
            if event.get("schema_version") is None:
                raise ValueError("Telemetry event missing schema_version")
            prompt_hash = event.get("prompt_hash")
            if event_type in {"prompt_received", "tool_invocation", "final_response"}:
                if not prompt_hash:
                    raise ValueError("Telemetry event missing prompt_hash")
            if not prompt_hash:
                continue
            bucket = grouped[prompt_hash]
            if event_type == "prompt_received":
                bucket["instruction"] = redact_value(event.get("prompt_preview", ""))
            elif event_type == "tool_invocation":
                bucket["tool_calls"].append(
                    {
                        "name": event.get("tool_name"),
                        "args": redact_value(event.get("tool_args_preview", {})),
                        "success": event.get("success"),
                    }
                )
            elif event_type == "final_response":
                bucket["expected_answer"] = redact_value(
                    event.get("response_preview", "")
                )
    return grouped


def build_records(grouped: dict, tool_schema: str) -> list[dict]:
    records = []
    for prompt_hash in sorted(grouped.keys()):
        data = grouped[prompt_hash]
        instruction = data.get("instruction")
        expected_answer = data.get("expected_answer")
        if not instruction or not expected_answer:
            continue
        tool_calls = data.get("tool_calls", [])
        tool_calls_sorted = sorted(
            tool_calls,
            key=lambda call: stable_dumps({"name": call.get("name"), "args": call.get("args")}),
        )
        expected_tool_call = {
            "tools": [
                {
                    "name": call.get("name"),
                    "args": call.get("args", {}),
                    "success": call.get("success"),
                }
                for call in tool_calls_sorted
                if call.get("name")
            ]
        }
        records.append(
            {
                "instruction": instruction,
                "context": "",
                "tool_schema": tool_schema,
                "expected_tool_call": expected_tool_call,
                "expected_answer": expected_answer,
            }
        )
    return records


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Convert telemetry JSONL into SFT-ready JSONL."
    )
    parser.add_argument("--telemetry", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--tool-schema", default="")
    args = parser.parse_args()

    telemetry_path = Path(args.telemetry)
    if not telemetry_path.exists():
        raise FileNotFoundError(f"Telemetry not found: {telemetry_path}")

    tool_schema = load_tool_schema(args.tool_schema)
    grouped = parse_events(telemetry_path)
    records = build_records(grouped, tool_schema)

    os.makedirs(Path(args.output).parent, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        for record in records:
            handle.write(stable_dumps(record) + "\n")

    print(f"Wrote {len(records)} records to {args.output}")


if __name__ == "__main__":
    main()
