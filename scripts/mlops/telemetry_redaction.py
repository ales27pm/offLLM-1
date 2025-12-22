import argparse
import json
import re
from pathlib import Path
from typing import Any

MAX_VALUE_LENGTH = 2000


def load_redaction_patterns() -> dict[str, re.Pattern]:
    patterns_path = (
        Path(__file__).resolve().parents[2] / "schemas" / "redaction_patterns.json"
    )
    with patterns_path.open("r", encoding="utf-8") as handle:
        raw = json.load(handle)
    return {
        "email": re.compile(raw["email"], re.IGNORECASE),
        "phone": re.compile(raw["phone"]),
        "token": re.compile(raw["token"]),
        "secret": re.compile(raw["secret"], re.IGNORECASE),
        "bearer": re.compile(raw["bearer"]),
        "sensitive_key": re.compile(raw["sensitive_key"], re.IGNORECASE),
    }


def redact_string(value: str, patterns: dict[str, re.Pattern]) -> str:
    result = patterns["email"].sub("[REDACTED_EMAIL]", value)
    result = patterns["phone"].sub("[REDACTED_PHONE]", result)
    result = patterns["bearer"].sub("Bearer [REDACTED]", result)
    result = patterns["token"].sub("[REDACTED_TOKEN]", result)
    result = patterns["secret"].sub("[REDACTED_SECRET]", result)
    if len(result) > MAX_VALUE_LENGTH:
        result = f"{result[:MAX_VALUE_LENGTH]}…[TRUNCATED]"
    return result


def redact_value(value: Any, patterns: dict[str, re.Pattern]) -> Any:
    if value is None:
        return value
    if isinstance(value, str):
        return redact_string(value, patterns)
    if isinstance(value, (int, float, bool)):
        return value
    if isinstance(value, list):
        return [redact_value(item, patterns) for item in value]
    if isinstance(value, dict):
        redacted = {}
        for key, entry in value.items():
            if patterns["sensitive_key"].search(str(key)):
                redacted[key] = "[REDACTED]"
            else:
                redacted[key] = redact_value(entry, patterns)
        return redacted
    return redact_string(str(value), patterns)


def stable_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


def load_telemetry_schema() -> dict:
    schema_path = Path(__file__).resolve().parents[2] / "schemas" / "telemetry_event.schema.json"
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


def validate_event_schema(event: dict, schema: dict) -> list[str]:
    errors: list[str] = []
    required = schema.get("required", [])
    properties = schema.get("properties", {})
    for field in required:
        if field not in event:
            errors.append(f"missing required field: {field}")
            continue
        expected_type = properties.get(field, {}).get("type")
        if expected_type and not _matches_type(event.get(field), expected_type):
            errors.append(f"invalid type for {field}")
    return errors


def redact_event(event: dict, patterns: dict[str, re.Pattern]) -> dict:
    redacted = redact_value(event, patterns)
    if isinstance(redacted, dict):
        redacted["redaction_applied"] = stable_dumps(redacted) != stable_dumps(event)
    return redacted


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Redact telemetry JSONL and validate against the schema."
    )
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail if any event fails schema validation.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise FileNotFoundError(f"Telemetry not found: {input_path}")

    schema = load_telemetry_schema()
    patterns = load_redaction_patterns()
    errors = 0
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with input_path.open("r", encoding="utf-8") as handle, output_path.open(
        "w", encoding="utf-8"
    ) as out:
        for line in handle:
            if not line.strip():
                continue
            event = json.loads(line)
            redacted = redact_event(event, patterns)
            validation_errors = validate_event_schema(redacted, schema)
            if validation_errors:
                errors += 1
                if args.strict:
                    raise ValueError(
                        "Telemetry schema validation failed: "
                        + "; ".join(validation_errors)
                    )
                continue
            out.write(stable_dumps(redacted) + "\n")

    print(f"Wrote redacted telemetry to {output_path}")
    if errors:
        print(f"Skipped {errors} invalid events")


if __name__ == "__main__":
    main()
