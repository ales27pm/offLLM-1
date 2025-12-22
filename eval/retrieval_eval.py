import argparse
import json
import subprocess
import sys
from pathlib import Path


def load_documents(directory: Path) -> list[dict]:
    docs = []
    for path in sorted(directory.glob("**/*")):
        if path.is_dir():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore").strip()
        if not text:
            continue
        docs.append({"id": path.relative_to(directory).as_posix(), "text": text})
    return docs


def run_chunking(documents: list[dict], options: dict) -> dict:
    payload = json.dumps({"documents": documents, "options": options})
    result = subprocess.run(
        ["node", "eval/chunk_text.mjs"],
        input=payload,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Chunking failed")
    return json.loads(result.stdout).get("chunks", {})


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate retrieval chunking stability and distribution."
    )
    parser.add_argument("--documents", required=True)
    parser.add_argument("--max-chars", type=int, default=12000)
    parser.add_argument("--overlap", type=int, default=200)
    parser.add_argument("--min-docs", type=int, default=20)
    args = parser.parse_args()

    docs_dir = Path(args.documents)
    if not docs_dir.exists():
        raise FileNotFoundError(f"Documents not found: {docs_dir}")

    documents = load_documents(docs_dir)
    if len(documents) < args.min_docs:
        raise SystemExit(
            f"Need at least {args.min_docs} documents, found {len(documents)}"
        )

    options = {"maxChars": args.max_chars, "overlap": args.overlap}
    first = run_chunking(documents, options)
    second = run_chunking(documents, options)

    if first != second:
        raise SystemExit("Chunking is non-deterministic across runs")

    lengths = []
    empty_docs = 0
    for doc in documents:
        chunks = first.get(doc["id"], [])
        if not chunks:
            empty_docs += 1
            continue
        for chunk in chunks:
            lengths.append(len(chunk))

    if empty_docs:
        raise SystemExit(f"Found {empty_docs} documents with no chunks")

    if not lengths:
        raise SystemExit("No chunks produced")

    max_length = max(lengths)
    if max_length > args.max_chars:
        raise SystemExit(
            f"Chunk exceeds max_chars: {max_length} > {args.max_chars}"
        )

    summary = {
        "documents": len(documents),
        "chunks": len(lengths),
        "min_chunk_length": min(lengths),
        "max_chunk_length": max_length,
        "avg_chunk_length": sum(lengths) / len(lengths),
        "deterministic": True,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
