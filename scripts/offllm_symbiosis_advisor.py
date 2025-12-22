#!/usr/bin/env python3
"""Canonical entrypoint for Symbiosis advisor (v6)."""

from __future__ import annotations

import sys
from pathlib import Path

repo_root = Path(__file__).resolve().parents[1]
if str(repo_root) not in sys.path:
    sys.path.insert(0, str(repo_root))

from scripts.offllm_symbiosis_advisor_v6 import main  # noqa: E402


if __name__ == "__main__":
    raise SystemExit(main())
