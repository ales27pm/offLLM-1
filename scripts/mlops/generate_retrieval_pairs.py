import argparse
import json
from pathlib import Path

from scripts.mlops.telemetry_redaction import (
    load_redaction_patterns,
    load_telemetry_schema,
    redact_event,
    redact_value,
    stable_dumps,
    validate_event_schema,
)


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
    patterns = load_redaction_patterns()
    schema = load_telemetry_schema()
    with telemetry_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            event = json.loads(line)
            redacted = redact_event(event, patterns)
            if validate_event_schema(redacted, schema):
                continue
            event_type = redacted.get("event_type") or redacted.get("event")
            if event_type != "retrieval":
                continue
            result_ids = redacted.get("retrieval_hits") or redacted.get("result_ids") or []
            if not result_ids:
                continue
            positive_id = result_ids[0]
            negatives = result_ids[1 : 1 + args.max_negatives]
            pairs.append(
                {
                    "query_hash": redacted.get("query_hash"),
                    "query_preview": redact_value(
                        redacted.get("query_preview"), patterns
                    ),
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
