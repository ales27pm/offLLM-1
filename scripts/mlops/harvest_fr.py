import argparse
import json
import os
from typing import Dict, Iterable

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

from datasets import load_dataset


def load_manifest(path: str) -> dict:
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Manifest not found: {path}")
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def stream_source_records(source: dict) -> Iterable[Dict[str, str]]:
    dataset = load_dataset(
        source["dataset"],
        source.get("subset"),
        split=source.get("split", "train"),
        streaming=True,
    )
    text_field = source.get("text_field", "text")
    for record in dataset:
        text = record.get(text_field)
        if not text:
            continue
        yield {
            "text": text,
            "source": source["name"],
            "dataset": source["dataset"],
            "subset": source.get("subset"),
        }


def harvest_sources(
    manifest: dict,
    output_path: str,
    max_records: int,
    min_chars: int,
    selected_sources: list[str],
) -> None:
    sources = manifest.get("sources", [])
    if selected_sources:
        sources = [s for s in sources if s["name"] in selected_sources]

    if not sources:
        raise ValueError("No sources selected for harvesting")

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    total_written = 0
    with open(output_path, "w", encoding="utf-8") as handle:
        for source in sources:
            written_for_source = 0
            for record in stream_source_records(source):
                text = record["text"].strip()
                if len(text) < min_chars:
                    continue
                payload = {
                    "text": text,
                    "source": record["source"],
                    "dataset": record["dataset"],
                    "subset": record["subset"],
                }
                handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
                written_for_source += 1
                total_written += 1
                if max_records and total_written >= max_records:
                    return
            if written_for_source == 0:
                print(f"Warning: no records written for {source['name']}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Harvest French text data from HF datasets using a manifest."
    )
    parser.add_argument(
        "--manifest",
        default=os.path.join(
            os.path.dirname(__file__), "sources_fr_manifest.json"
        ),
    )
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-records", type=int, default=1000)
    parser.add_argument("--min-chars", type=int, default=200)
    parser.add_argument(
        "--sources",
        nargs="*",
        default=[],
        help="Optional list of source names to include",
    )
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    harvest_sources(
        manifest,
        args.output,
        args.max_records,
        args.min_chars,
        args.sources,
    )
    print(f"Harvest completed: {args.output}")


if __name__ == "__main__":
    main()
    if os.environ.get("HARVEST_HARD_EXIT") == "1":
        os.sys.stdout.flush()
        os.sys.stderr.flush()
        os._exit(0)
