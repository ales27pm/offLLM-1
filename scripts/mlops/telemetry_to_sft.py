import argparse
import json
import os
import sys
from collections import defaultdict
from typing import Optional
from pathlib import Path

from scripts.mlops.telemetry_redaction import (
    load_redaction_patterns,
    load_telemetry_schema,
    redact_event,
    stable_dumps,
    validate_event_schema,
)


def load_tool_schema(path: str) -> str:
    if not path:
        return ""
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Tool schema not found: {path}")
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read().strip()


def normalize_event_type(event: dict, strict_schema: bool) -> Optional[str]:
    event_type = event.get("event_type") or event.get("event")
    if not event_type:
        if strict_schema:
            raise ValueError("Telemetry event missing event_type")
        return None
    return event_type


def parse_events(path: Path, strict_schema: bool) -> dict:
    grouped = defaultdict(lambda: {"tool_calls": []})
    patterns = load_redaction_patterns()
    schema = load_telemetry_schema()
    missing_event_type = 0
    missing_prompt_hash = 0
    invalid_schema = 0
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            event = json.loads(line)
            redacted = redact_event(event, patterns)
            errors = validate_event_schema(redacted, schema)
            if errors:
                invalid_schema += 1
                if strict_schema:
                    raise ValueError(
                        f"Telemetry schema validation failed: {'; '.join(errors)}"
                    )
                continue
            event_type = normalize_event_type(redacted, strict_schema)
            if not event_type:
                missing_event_type += 1
                continue
            prompt_hash = redacted.get("prompt_hash")
            if event_type in {"prompt_received", "tool_invocation", "final_response"}:
                if not prompt_hash and strict_schema:
                    raise ValueError("Telemetry event missing prompt_hash")
            if not prompt_hash:
                missing_prompt_hash += 1
                continue
            bucket = grouped[prompt_hash]
            bucket["prompt_id"] = redacted.get("prompt_id")
            bucket["prompt_version"] = redacted.get("prompt_version")
            bucket["model_id"] = redacted.get("model_id")
            if event_type == "prompt_received":
                bucket["instruction"] = redacted.get("prompt_preview", "")
            elif event_type == "tool_invocation":
                bucket["tool_calls"].append(
                    {
                        "name": redacted.get("tool_name"),
                        "args": redacted.get("tool_args_preview", {}),
                        "success": redacted.get("success"),
                    }
                )
            elif event_type == "final_response":
                bucket["expected_answer"] = redacted.get("response_preview", "")
    if not strict_schema:
        if missing_event_type:
            print(
                f"Warning: skipped {missing_event_type} events without event_type",
                file=sys.stderr,
            )
        if missing_prompt_hash:
            print(
                f"Warning: skipped {missing_prompt_hash} events without prompt_hash",
                file=sys.stderr,
            )
        if invalid_schema:
            print(
                f"Warning: skipped {invalid_schema} events that failed schema validation",
                file=sys.stderr,
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
                "prompt_id": data.get("prompt_id"),
                "prompt_version": data.get("prompt_version"),
                "model_id": data.get("model_id"),
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
    parser.add_argument(
        "--strict-schema",
        action="store_true",
        help="Fail when telemetry events miss schema fields (event_type/schema_version).",
    )
    args = parser.parse_args()

    telemetry_path = Path(args.telemetry)
    if not telemetry_path.exists():
        raise FileNotFoundError(f"Telemetry not found: {telemetry_path}")

    tool_schema = load_tool_schema(args.tool_schema)
    grouped = parse_events(telemetry_path, args.strict_schema)
    records = build_records(grouped, tool_schema)

    os.makedirs(Path(args.output).parent, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        for record in records:
            handle.write(stable_dumps(record) + "\n")

    print(f"Wrote {len(records)} records to {args.output}")


if __name__ == "__main__":
    main()
