import argparse
import json
import os
from collections import defaultdict
from pathlib import Path


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
            prompt_hash = event.get("prompt_hash")
            if not prompt_hash:
                continue
            bucket = grouped[prompt_hash]
            event_type = event.get("event")
            if event_type == "prompt_received":
                bucket["instruction"] = event.get("prompt_preview", "")
            elif event_type == "tool_invocation":
                bucket["tool_calls"].append(
                    {
                        "name": event.get("tool_name"),
                        "args": event.get("tool_args_preview", {}),
                        "success": event.get("success"),
                    }
                )
            elif event_type == "final_response":
                bucket["expected_answer"] = event.get("response_preview", "")
    return grouped


def build_records(grouped: dict, tool_schema: str) -> list[dict]:
    records = []
    for _, data in grouped.items():
        instruction = data.get("instruction")
        expected_answer = data.get("expected_answer")
        if not instruction or not expected_answer:
            continue
        tool_calls = data.get("tool_calls", [])
        expected_tool_call = {
            "tools": [
                {
                    "name": call.get("name"),
                    "args": call.get("args", {}),
                    "success": call.get("success"),
                }
                for call in tool_calls
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
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"Wrote {len(records)} records to {args.output}")


if __name__ == "__main__":
    main()
