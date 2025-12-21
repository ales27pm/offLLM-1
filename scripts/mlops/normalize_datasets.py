import argparse
import json
import os
from pathlib import Path


def normalize_sft(record: dict) -> dict:
    required = {"instruction", "expected_answer"}
    missing = required - record.keys()
    if missing:
        raise ValueError(f"Missing required keys for SFT: {missing}")
    return {
        "instruction": (record.get("instruction") or "").strip(),
        "context": record.get("context", ""),
        "tool_schema": record.get("tool_schema", ""),
        "expected_tool_call": record.get("expected_tool_call", {}),
        "expected_answer": (record.get("expected_answer") or "").strip(),
    }


def normalize_pretrain(record: dict) -> dict:
    text = record.get("text") or record.get("content")
    if not text:
        raise ValueError("Missing 'text' content for pretrain normalization")
    return {
        "text": text.strip(),
        "metadata": {k: v for k, v in record.items() if k not in {"text", "content"}},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize dataset JSONL files.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--mode",
        choices=["sft", "pretrain"],
        required=True,
        help="Normalization mode to apply.",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        raise FileNotFoundError(f"Input not found: {input_path}")

    os.makedirs(Path(args.output).parent, exist_ok=True)

    normalizer = normalize_sft if args.mode == "sft" else normalize_pretrain
    with input_path.open("r", encoding="utf-8") as source, open(
        args.output, "w", encoding="utf-8"
    ) as target:
        for line in source:
            if not line.strip():
                continue
            record = json.loads(line)
            normalized = normalizer(record)
            target.write(json.dumps(normalized, ensure_ascii=False) + "\n")

    print(f"Normalized dataset written to {args.output}")


if __name__ == "__main__":
    main()
