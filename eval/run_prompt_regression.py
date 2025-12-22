#!/usr/bin/env python3
"""
Strict forwarder required by CI guard.

This file must not contain business logic.
All implementation lives in scripts/eval/run_prompt_regression.py
"""

from scripts.eval.run_prompt_regression import main

if __name__ == "__main__":
    raise SystemExit(main())
