#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def _load_main():
    repo_root = Path(__file__).resolve().parents[1]
    target = repo_root / "scripts" / "eval" / "run_prompt_regression.py"
    spec = importlib.util.spec_from_file_location("prompt_regression", target)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load: {target}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.main


if __name__ == "__main__":
    _load_main()()
