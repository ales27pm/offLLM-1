import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from scripts.mlops.telemetry_redaction import (  # noqa: E402
    load_redaction_patterns,
    load_telemetry_schema,
    redact_event,
    stable_dumps,
    validate_event_schema,
)


def build_retrieval_triples(path: Path, strict_schema: bool) -> list[dict]:
    patterns = load_redaction_patterns()
    schema = load_telemetry_schema()
    triples = []
    invalid_events = 0
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
            event_type = redacted.get("event_type") or redacted.get("type")
            if event_type not in {"retrieval", "retrieval_trace"}:
                continue

            prompt = redacted.get("prompt") or {}
            prompt_id = prompt.get("prompt_id") or redacted.get("prompt_id")
            prompt_version = prompt.get("prompt_version") or redacted.get("prompt_version")
            model_id = redacted.get("model_id") or (redacted.get("model") or {}).get("id")

            if event_type == "retrieval":
                query = redacted.get("query_preview")
                retrieval_hits = redacted.get("retrieval_hits") or []
                trace = redacted.get("retrieval_trace") or {}
                candidate_ids = trace.get("candidate_ids") or []
                candidate_scores = trace.get("candidate_scores") or []
                candidate_ranked = sorted(
                    zip(candidate_ids, candidate_scores),
                    key=lambda pair: pair[1],
                    reverse=True,
                )
                negatives = [
                    candidate_id
                    for candidate_id, _score in candidate_ranked
                    if candidate_id not in retrieval_hits
                ]
                if not query or not retrieval_hits or not negatives:
                    continue
                triples.append(
                    {
                        "query": query,
                        "positive": retrieval_hits[0],
                        "hard_negative": negatives[0],
                        "prompt_id": prompt_id,
                        "prompt_version": prompt_version,
                        "model_id": model_id,
                    }
                )
                continue

            payload = redacted.get("payload") or {}
            query = payload.get("query")
            hits = payload.get("hits") or []
            if not query or len(hits) < 2:
                continue
            positives = sorted(hits, key=lambda hit: hit.get("score", 0), reverse=True)
            triples.append(
                {
                    "query": query,
                    "positive": positives[0].get("doc_id"),
                    "hard_negative": positives[-1].get("doc_id"),
                    "prompt_id": prompt_id,
                    "prompt_version": prompt_version,
                    "model_id": model_id,
                }
            )
    if invalid_events:
        print(
            f"Warning: skipped {invalid_events} invalid telemetry events",
            file=sys.stderr,
        )
    return triples


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate retrieval triples from telemetry JSONL."
    )
    parser.add_argument("--telemetry", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-records", type=int, default=500000)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail on telemetry schema violations.",
    )
    args = parser.parse_args()

    telemetry_path = Path(args.telemetry)
    if not telemetry_path.exists():
        raise FileNotFoundError(f"Telemetry not found: {telemetry_path}")

    triples = build_retrieval_triples(telemetry_path, args.strict)
    if not triples:
        raise ValueError("No retrieval triples produced")
    if len(triples) > args.max_records:
        raise ValueError(f"Retrieval triple dataset too large: {len(triples)}")

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        for triple in triples:
            handle.write(stable_dumps(triple) + "\n")

    print(f"Wrote {len(triples)} retrieval triples to {output_path}")


if __name__ == "__main__":
    main()
