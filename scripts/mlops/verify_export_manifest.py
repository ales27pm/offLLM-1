import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any


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


def verify_manifest(
    manifest: dict[str, Any], repo_root: Path, model_override: Path | None
) -> dict[str, Any]:
    errors = []
    commit_sha = manifest.get("commit_sha")
    if commit_sha != resolve_commit_sha(repo_root):
        errors.append("commit_sha does not match repository HEAD")

    model_path = Path(manifest.get("model_path", ""))
    if not model_path.exists():
        errors.append(f"model_path not found: {model_path}")
    else:
        expected_hash = manifest.get("model_hash")
        actual_hash = (
            sha256_directory(model_path) if model_path.is_dir() else sha256_file(model_path)
        )
        if expected_hash != actual_hash:
            errors.append("model_hash does not match model_path contents")

    if model_override is not None:
        if model_path.resolve() != model_override.resolve():
            errors.append("model_path does not match override path")

    dataset_hashes = manifest.get("dataset_hashes", {})
    if not isinstance(dataset_hashes, dict):
        errors.append("dataset_hashes must be an object")
    else:
        for dataset_path, expected_hash in dataset_hashes.items():
            path_obj = Path(dataset_path)
            if not path_obj.exists():
                errors.append(f"dataset not found: {dataset_path}")
                continue
            actual_hash = sha256_file(path_obj)
            if actual_hash != expected_hash:
                errors.append(f"dataset hash mismatch: {dataset_path}")

    return {"errors": errors}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify export/manifest.json against repo and artifacts."
    )
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--model-path", default=None)
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    with manifest_path.open("r", encoding="utf-8") as handle:
        manifest = json.load(handle)

    repo_root = Path(__file__).resolve().parents[2]
    model_override = Path(args.model_path) if args.model_path else None
    result = verify_manifest(manifest, repo_root, model_override)
    if result["errors"]:
        raise SystemExit("; ".join(result["errors"]))
    print(f"Manifest verified: {manifest_path}")


if __name__ == "__main__":
    main()
