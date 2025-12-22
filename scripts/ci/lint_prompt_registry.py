#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from pathlib import Path

PROMPT_MARKERS = [
    "SYSTEM_PROMPT",
    "system prompt",
    "### Instruction",
    "You are offLLM",
    "You are an assistant",
    "TOOL_CALL",
]

ALLOWED_DIRS = {
    "prompts",
    "__tests__",
    "scripts",
    "eval",
    "docs",
}

SKIP_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    ".cache",
    ".venv",
    "Pods",
    "DerivedData",
    "reports",
    "runs",
}

TEXT_EXT = {
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".swift",
    ".md",
    ".json",
    ".yml",
    ".yaml",
    ".sh",
}


def is_allowed(path: Path) -> bool:
    if not path.parts:
        return False
    return path.parts[0] in ALLOWED_DIRS


def should_scan(path: Path) -> bool:
    if path.name == "AGENTS.md":
        return False
    if any(part in SKIP_DIRS for part in path.parts):
        return False
    if path.suffix.lower() not in TEXT_EXT:
        return False
    if is_allowed(path):
        return False
    return True


def scan_file(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []
    hits = []
    for marker in PROMPT_MARKERS:
        if marker in text:
            hits.append(marker)
    return hits


def main() -> int:
    repo_root = Path(os.environ.get("GITHUB_WORKSPACE", Path.cwd()))
    offenders: list[tuple[str, list[str]]] = []
    for p in repo_root.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(repo_root)
        if not should_scan(rel):
            continue
        hits = scan_file(p)
        if hits:
            offenders.append((str(rel), hits))

    if offenders:
        print(
            "Prompt registry lint failed: prompt markers found outside prompts/ registry.",
            file=sys.stderr,
        )
        for f, hits in offenders[:200]:
            print(f"- {f}: {hits}", file=sys.stderr)
        print(
            "\nFix: move prompt text into prompts/v*/ files and register in prompts/registry.json",
            file=sys.stderr,
        )
        return 2

    print("Prompt registry lint OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
