#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${OFFLLM_EVAL_MODEL_CMD:-}" ]]; then
  echo "OFFLLM_EVAL_MODEL_CMD must be set to the deterministic model command." >&2
  exit 1
fi

python scripts/eval/run_prompt_regression.py \
  --prompts scripts/eval/golden_prompts.json \
  --prompts eval/redteam_tool_injection.json \
  --model-cmd "$OFFLLM_EVAL_MODEL_CMD" \
  --summary eval/prompt_regression_summary.json \
  --sarif eval/prompt_regression.sarif
