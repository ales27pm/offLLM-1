import argparse
import json
import os
from collections import Counter
from pathlib import Path


def scan_jsonl(path: Path, max_samples: int) -> dict:
    stats = {
        "path": str(path),
        "bytes": path.stat().st_size,
        "records": 0,
        "avg_text_length": 0,
        "keys": Counter(),
        "sample": [],
    }
    total_length = 0
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            stats["records"] += 1
            record = json.loads(line)
            stats["keys"].update(record.keys())
            text = record.get("text") or record.get("instruction") or ""
            total_length += len(text)
            if len(stats["sample"]) < max_samples:
                stats["sample"].append(record)
    if stats["records"]:
        stats["avg_text_length"] = total_length / stats["records"]
    stats["keys"] = dict(stats["keys"])
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description="Scan internal dataset files.")
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-samples", type=int, default=3)
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        raise FileNotFoundError(f"Data directory not found: {data_dir}")

    reports = []
    for path in data_dir.rglob("*.jsonl"):
        reports.append(scan_jsonl(path, args.max_samples))

    output_path = Path(args.output)
    os.makedirs(output_path.parent, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(reports, handle, ensure_ascii=False, indent=2)

    print(f"Scan complete: {output_path}")


if __name__ == "__main__":
    main()
