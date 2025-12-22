#!/usr/bin/env python3
"""CI guardrails for eval/symbiosis duplication and ignore rules."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def fail(messages: list[str]) -> None:
    for message in messages:
        print(f"[guard] {message}", file=sys.stderr)
    raise SystemExit(1)


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    messages: list[str] = []

    eval_runner = REPO_ROOT / "eval" / "run_prompt_regression.py"
    scripts_runner = REPO_ROOT / "scripts" / "eval" / "run_prompt_regression.py"
    if eval_runner.exists() and scripts_runner.exists():
        text = eval_runner.read_text(encoding="utf-8")
        if "scripts.eval.run_prompt_regression" not in text:
            messages.append("eval/run_prompt_regression.py must forward to scripts/eval/run_prompt_regression.py")
        for marker in ("PromptCase", "invoke_model", "load_cases", "parse_tool_calls"):
            if marker in text:
                messages.append("eval/run_prompt_regression.py contains real logic; must be a thin forwarder")
                break
    else:
        messages.append("Missing prompt regression runner in eval/ or scripts/eval")

    golden_scripts = REPO_ROOT / "scripts" / "eval" / "golden_prompts.json"
    golden_eval = REPO_ROOT / "eval" / "golden_prompts.json"
    if not golden_scripts.exists():
        messages.append("scripts/eval/golden_prompts.json is missing")
    if golden_eval.exists():
        messages.append("eval/golden_prompts.json must not exist (duplicate golden prompts)")

    symbiosis_path = REPO_ROOT / "scripts" / "offllm_symbiosis_advisor_v6.py"
    if not symbiosis_path.exists():
        messages.append("scripts/offllm_symbiosis_advisor_v6.py is missing")
    else:
        mod = load_module(symbiosis_path, "symbiosis_v6_guard")
        exclude_dirs = set(getattr(mod, "DEFAULT_EXCLUDE_DIRS", set()))
        ignore_globs = set(getattr(mod, "DEFAULT_IGNORE_GLOBS", []))

        def require_dir(name: str, glob: str) -> None:
            if name not in exclude_dirs and glob not in ignore_globs:
                messages.append(f"Symbiosis ignore rules missing for {name}/ or {glob}")

        require_dir("reports", "reports/**")
        require_dir("runs", "runs/**")
        require_dir("node_modules", "node_modules/**")
        require_dir(".git", ".git/**")
        require_dir("dist", "dist/**")
        require_dir("build", "build/**")

        for glob in ("**/*.sarif", "**/*prompt-regression*", "**/*symbiosis*report*"):
            if glob not in ignore_globs:
                messages.append(f"Symbiosis ignore rules missing for {glob}")

    if messages:
        fail(messages)

    print("[guard] eval/symbiosis guardrails OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
