import argparse
import json
import re
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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate contrastive retrieval pairs from telemetry logs."
    )
    parser.add_argument("--telemetry", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-negatives", type=int, default=4)
    args = parser.parse_args()

    telemetry_path = Path(args.telemetry)
    if not telemetry_path.exists():
        raise FileNotFoundError(f"Telemetry not found: {telemetry_path}")

    pairs = []
    with telemetry_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            event = json.loads(line)
            if event.get("event_type") != "retrieval":
                continue
            result_ids = event.get("result_ids") or []
            if not result_ids:
                continue
            positive_id = result_ids[0]
            negatives = result_ids[1 : 1 + args.max_negatives]
            pairs.append(
                {
                    "query_hash": event.get("query_hash"),
                    "query_preview": redact_value(event.get("query_preview")),
                    "positive_id": positive_id,
                    "negative_ids": negatives,
                }
            )

    pairs_sorted = sorted(
        pairs,
        key=lambda item: stable_dumps(
            {"query_hash": item.get("query_hash"), "positive_id": item.get("positive_id")}
        ),
    )

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for pair in pairs_sorted:
            handle.write(stable_dumps(pair) + "\n")

    print(f"Wrote {len(pairs_sorted)} pairs to {output_path}")


if __name__ == "__main__":
    main()
