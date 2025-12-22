#!/usr/bin/env python3
from __future__ import annotations

import runpy
from pathlib import Path


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    canonical = "scripts/eval/run_prompt_regression.py"
    target = repo_root / canonical
    runpy.run_path(str(target), run_name="__main__")


if __name__ == "__main__":
    main()
