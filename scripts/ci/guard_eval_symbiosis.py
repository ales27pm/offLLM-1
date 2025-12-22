#!/usr/bin/env python3

from pathlib import Path
import sys

FORWARDER = Path("eval/run_prompt_regression.py")
TARGET = Path("scripts/eval/run_prompt_regression.py")


def fail(msg: str) -> None:
    print(f"[guard] {msg}", file=sys.stderr)
    sys.exit(1)


def main() -> None:
    if not FORWARDER.exists():
        fail("eval/run_prompt_regression.py does not exist")

    if not TARGET.exists():
        fail("scripts/eval/run_prompt_regression.py does not exist")

    text = FORWARDER.read_text(encoding="utf-8")

    if "scripts.eval.run_prompt_regression" not in text:
        fail(
            "eval/run_prompt_regression.py must forward to "
            "scripts/eval/run_prompt_regression.py"
        )

    print("[guard] eval prompt regression wiring OK")


if __name__ == "__main__":
    main()
