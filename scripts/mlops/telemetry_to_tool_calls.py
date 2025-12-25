import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.mlops.telemetry_redaction import (  # noqa: E402
    load_redaction_patterns,
    load_telemetry_schema,
    redact_event,
    stable_dumps,
    validate_event_schema,
)


def load_tool_schema(tool_name: str) -> dict:
    schema_path = (
        Path(__file__).resolve().parents[2]
        / "schemas"
        / "tools"
        / f"{tool_name}.schema.json"
    )
    if not schema_path.exists():
        raise FileNotFoundError(f"Tool schema not found: {schema_path}")
    with schema_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _matches_type(value: Any, expected: Any) -> bool:
    if isinstance(expected, list):
        return any(_matches_type(value, entry) for entry in expected)
    if expected == "string":
        return isinstance(value, str)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "array":
        return isinstance(value, list)
    if expected == "null":
        return value is None
    return True


def validate_tool_args(tool_name: str, args: Any) -> list[str]:
    if not isinstance(args, dict):
        return [f"{tool_name} args must be an object"]
    schema = load_tool_schema(tool_name)
    errors: list[str] = []
    properties = schema.get("properties", {})
    required = schema.get("required", [])
    for field in required:
        if field not in args:
            errors.append(f"{tool_name} missing required field: {field}")
    for key, value in args.items():
        expected_type = properties.get(key, {}).get("type")
        if expected_type and not _matches_type(value, expected_type):
            errors.append(f"{tool_name} field {key} has invalid type")
    if schema.get("additionalProperties") is False:
        allowed = set(properties.keys())
        extras = [key for key in args.keys() if key not in allowed]
        for extra in extras:
            errors.append(f"{tool_name} has unknown field: {extra}")
    return errors


def _prompt_meta(event: dict) -> dict:
    prompt = event.get("prompt") if event.get("prompt") is not None else {}
    return {
        "prompt_id": prompt.get("prompt_id") or event.get("prompt_id"),
        "prompt_version": prompt.get("prompt_version") or event.get("prompt_version"),
        "prompt_hash": prompt.get("system_hash") or event.get("prompt_hash"),
        "model_id": event.get("model_id") or (event.get("model") if event.get("model") is not None else {}).get("id"),
    }

def _extract_tool_call(event: dict) -> tuple[str | None, dict | None, dict]:
    if event.get("event_type") == "tool_invocation":
        return (
            event.get("tool_name"),
            event.get("tool_args_preview"),
            _prompt_meta(event),
        )
    if event.get("type") == "tool_call":
        payload = event.get("payload") or {}
        return payload.get("tool"), payload.get("args"), _prompt_meta(event)
    return None, None, {}


def build_tool_call_records(path: Path, strict_schema: bool) -> list[dict]:
    patterns = load_redaction_patterns()
    schema = load_telemetry_schema()
    records = []
    invalid_events = 0
    invalid_tools = 0
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            event = json.loads(line)
            redacted = redact_event(event, patterns)
            errors = validate_event_schema(redacted, schema)
            if errors:
                invalid_events += 1
                if strict_schema:
                    raise ValueError(
                        f"Telemetry schema validation failed: {'; '.join(errors)}"
                    )
                continue
            tool_name, tool_args, meta = _extract_tool_call(redacted)
            if not tool_name:
                continue
            tool_errors = validate_tool_args(tool_name, tool_args)
            if tool_errors:
                invalid_tools += 1
                if strict_schema:
                    raise ValueError("; ".join(tool_errors))
                continue
            records.append(
                {
                    "prompt_id": meta.get("prompt_id"),
                    "prompt_version": meta.get("prompt_version"),
                    "model_id": meta.get("model_id"),
                    "prompt_hash": meta.get("prompt_hash"),
                    "tool_name": tool_name,
                    "tool_args": tool_args,
                    "success": redacted.get("success"),
                    "error": redacted.get("error"),
                }
            )
    if invalid_events:
        print(f"Warning: skipped {invalid_events} invalid telemetry events", file=sys.stderr)
    if invalid_tools:
        print(f"Warning: skipped {invalid_tools} invalid tool calls", file=sys.stderr)
    return records


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate tool call traces from telemetry JSONL."
    )
    parser.add_argument("--telemetry", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-records", type=int, default=500000)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail on telemetry schema or tool schema violations.",
    )
    args = parser.parse_args()

    telemetry_path = Path(args.telemetry)
    if not telemetry_path.exists():
        raise FileNotFoundError(f"Telemetry not found: {telemetry_path}")

    records = build_tool_call_records(telemetry_path, args.strict)
    if not records:
        raise ValueError("No tool call records produced")
    if len(records) > args.max_records:
        raise ValueError(f"Tool call dataset too large: {len(records)}")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(stable_dumps(record) + "\n")

    print(f"Wrote {len(records)} tool call records to {output_path}")


if __name__ == "__main__":
    main()
