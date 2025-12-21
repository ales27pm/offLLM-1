import argparse
import json
from pathlib import Path


def load_pairs(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def load_retrieval_events(path: Path) -> dict:
    events = {}
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            event = json.loads(line)
            if event.get("event") != "retrieval":
                continue
            events[event.get("query_hash")] = event
    return events


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate retrieval recall@k.")
    parser.add_argument("--pairs", required=True)
    parser.add_argument("--telemetry", required=True)
    parser.add_argument("--k", type=int, default=3)
    args = parser.parse_args()

    pairs = load_pairs(Path(args.pairs))
    telemetry = load_retrieval_events(Path(args.telemetry))

    total = 0
    hits = 0
    for pair in pairs:
        query_hash = pair.get("query_hash")
        positive_id = pair.get("positive_id")
        event = telemetry.get(query_hash)
        if not event or not positive_id:
            continue
        total += 1
        retrieved = event.get("result_ids", [])[: args.k]
        if positive_id in retrieved:
            hits += 1

    recall = hits / total if total else 0
    print(json.dumps({"recall_at_k": recall, "total": total, "hits": hits}, indent=2))


if __name__ == "__main__":
    main()
