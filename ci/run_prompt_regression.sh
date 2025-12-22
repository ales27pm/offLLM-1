#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${OFFLLM_EVAL_MODEL_CMD:-}" ]]; then
  echo "OFFLLM_EVAL_MODEL_CMD is not set; skipping prompt regression run." >&2
  exit 0
fi

python eval/run_prompt_regression.py \
  --prompts eval/golden_prompts.json \
  --prompts eval/redteam_tool_injection.json \
  --model-cmd "$OFFLLM_EVAL_MODEL_CMD" \
  --summary eval/prompt_regression_summary.json \
  --sarif eval/prompt_regression.sarif
