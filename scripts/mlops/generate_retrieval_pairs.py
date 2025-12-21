import argparse
import json
from pathlib import Path


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
            if event.get("event") != "retrieval":
                continue
            result_ids = event.get("result_ids") or []
            if not result_ids:
                continue
            positive_id = result_ids[0]
            negatives = result_ids[1 : 1 + args.max_negatives]
            pairs.append(
                {
                    "query_hash": event.get("query_hash"),
                    "query_preview": event.get("query_preview"),
                    "positive_id": positive_id,
                    "negative_ids": negatives,
                }
            )

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for pair in pairs:
            handle.write(json.dumps(pair, ensure_ascii=False) + "\n")

    print(f"Wrote {len(pairs)} pairs to {output_path}")


if __name__ == "__main__":
    main()
