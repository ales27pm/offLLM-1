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
