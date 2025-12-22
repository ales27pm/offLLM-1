#!/usr/bin/env python3
"""Validate Symbiosis output is artifact-blind."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Iterable

FORBIDDEN_PREFIXES = ("reports/", "runs/")
FORBIDDEN_SUBSTRINGS = ("symbiosis", "prompt-regression")


def iter_paths(report: dict) -> Iterable[str]:
    for snippet in report.get("prompt_snippets", []):
        file_path = snippet.get("file")
        if file_path:
            yield file_path
    for cluster in report.get("prompt_drift_clusters", []):
        for file_path in cluster.get("files", []):
            if file_path:
                yield file_path
    for entries in report.get("where_to_search", {}).values():
        if isinstance(entries, list):
            for file_path in entries:
                if file_path:
                    yield file_path


def is_forbidden(path: str) -> bool:
    path_lower = path.lower()
    if path.startswith(FORBIDDEN_PREFIXES):
        return True
    return any(token in path_lower for token in FORBIDDEN_SUBSTRINGS)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True, help="Path to symbiosis report JSON")
    args = parser.parse_args()

    report_path = Path(args.report)
    if not report_path.exists():
        print(f"[guard] Missing report: {report_path}", file=sys.stderr)
        return 1

    report = json.loads(report_path.read_text(encoding="utf-8"))
    offenders = sorted({p for p in iter_paths(report) if is_forbidden(p)})

    if offenders:
        print("[guard] Symbiosis indexed forbidden artifacts:", file=sys.stderr)
        for path in offenders:
            print(f" - {path}", file=sys.stderr)
        return 1

    print("[guard] Symbiosis output is artifact-blind")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
