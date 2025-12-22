import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def sha256_directory(path: Path) -> str:
    hasher = hashlib.sha256()
    files = sorted([p for p in path.rglob("*") if p.is_file()])
    for file_path in files:
        rel_path = file_path.relative_to(path).as_posix()
        file_hash = sha256_file(file_path)
        hasher.update(rel_path.encode("utf-8"))
        hasher.update(file_hash.encode("utf-8"))
    return hasher.hexdigest()


def resolve_commit_sha(repo_root: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "Unable to resolve git SHA")
    return result.stdout.strip()


def build_manifest(datasets: list[Path], model_path: Path, repo_root: Path) -> dict:
    dataset_hashes = {}
    for dataset in datasets:
        dataset_hashes[dataset.as_posix()] = sha256_file(dataset)
    if model_path.is_dir():
        model_hash = sha256_directory(model_path)
    else:
        model_hash = sha256_file(model_path)
    return {
        "commit_sha": resolve_commit_sha(repo_root),
        "dataset_hashes": dataset_hashes,
        "model_hash": model_hash,
        "model_path": model_path.as_posix(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Write export/manifest.json for training outputs."
    )
    parser.add_argument("--datasets", action="append", required=True)
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--output", default="export/manifest.json")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    datasets = [Path(dataset) for dataset in args.datasets]
    for dataset in datasets:
        if not dataset.exists():
            raise FileNotFoundError(f"Dataset not found: {dataset}")
    model_path = Path(args.model_path)
    if not model_path.exists():
        raise FileNotFoundError(f"Model path not found: {model_path}")

    manifest = build_manifest(datasets, model_path, repo_root)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write("\n")

    print(f"Wrote manifest to {output_path}")


if __name__ == "__main__":
    main()
