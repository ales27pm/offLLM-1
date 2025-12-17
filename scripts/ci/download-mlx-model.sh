#!/usr/bin/env bash
set -euo pipefail

# Download the bundled MLX or Core ML model for iOS builds so archives ship with weights.
#
# Environment variables:
#   MODEL_ID                Hugging Face repo id (default: Qwen/Qwen2-1.5B-Instruct-MLX)
#   MODEL_REVISION          Revision/branch to download (default: main)
#   MODEL_ROOT              Destination root for bundled models
#                            (default: ios/MyOfflineLLMApp/Models)
#   PYTHON_BIN              Python executable to use (default: python3)
#   MODEL_VENV_DIR          Optional path to reuse a Python virtualenv for dependencies
#   CI_FORCE_MODEL_REFRESH  When non-zero, remove any cached copy and redownload
#   VERIFY_MODEL_PIPELINE   "0" to skip transformers/MLX warm-up, "1" to force it,
#                           otherwise detected automatically (Darwin arm64 only; auto-skipped for Core ML)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

MODEL_ID="${MODEL_ID:-Qwen/Qwen2-1.5B-Instruct-MLX}"
MODEL_REVISION="${MODEL_REVISION:-main}"
MODEL_ROOT="${MODEL_ROOT:-${REPO_ROOT}/ios/MyOfflineLLMApp/Models}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
HOST_PYTHON="$PYTHON_BIN"
TARGET_DIR="${MODEL_ROOT}/${MODEL_ID}"
MODEL_FORMAT=""

log() {
  printf '==> %s\n' "$*"
}

die() {
  printf '::error::%s\n' "$*" >&2
  exit 1
}

dir_has_contents() {
  local dir="$1"
  [[ -d "$dir" ]] && [[ -n "$(ls -A -- "$dir" 2>/dev/null)" ]]
}

detect_model_format() {
  local dir="$1"
  [[ -d "$dir" ]] || return 1

  if find "$dir" \( -name '*.mlpackage' -o -name '*.mlmodelc' -o -name '*.mlmodel' \) -print -quit 2>/dev/null | grep -q .; then
    echo "coreml"
    return 0
  fi

  if find "$dir" -type f \( -name '*.safetensors' -o -name '*.gguf' -o -name '*.mlx' \) -print -quit 2>/dev/null | grep -q .; then
    echo "mlx"
    return 0
  fi

  return 1
}

if ! command -v "$HOST_PYTHON" >/dev/null 2>&1; then
  die "Python interpreter '$PYTHON_BIN' not found"
fi

if [[ "${CI_FORCE_MODEL_REFRESH:-0}" != "0" ]]; then
  log "CI_FORCE_MODEL_REFRESH enabled; removing existing model at ${TARGET_DIR}"
  rm -rf "$TARGET_DIR"
fi

if MODEL_FORMAT="$(detect_model_format "$TARGET_DIR")"; then
  log "Model artifacts (${MODEL_FORMAT}) already present at ${TARGET_DIR}; skipping download."
  exit 0
fi

log "Ensuring destination ${TARGET_DIR} exists"
mkdir -p "$TARGET_DIR"

if [[ -n "${MODEL_VENV_DIR:-}" ]]; then
  VENV_DIR="$MODEL_VENV_DIR"
  CLEANUP_VENV=0
else
  VENV_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mlx-model-venv-XXXXXXXX")"
  CLEANUP_VENV=1
fi

cleanup() {
  if [[ "${CLEANUP_VENV:-0}" -eq 1 ]]; then
    rm -rf "$VENV_DIR"
  fi
}
trap cleanup EXIT

if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  if [[ "${CLEANUP_VENV:-0}" -eq 0 ]] && dir_has_contents "$VENV_DIR"; then
    die "MODEL_VENV_DIR '${VENV_DIR}' exists but does not look like an empty Python virtual environment"
  fi
  if [[ "${CLEANUP_VENV:-0}" -eq 1 ]]; then
    rm -rf "$VENV_DIR"
  fi
  log "Creating Python virtual environment at ${VENV_DIR}"
  "$HOST_PYTHON" -m venv "$VENV_DIR" || die "Failed to create Python virtual environment at ${VENV_DIR}"
else
  log "Reusing Python virtual environment at ${VENV_DIR}"
fi

PYTHON_BIN="${VENV_DIR}/bin/python"

log "Installing huggingface_hub dependency inside ${VENV_DIR} (quietly)"
"$PYTHON_BIN" -m pip install --upgrade --quiet pip
"$PYTHON_BIN" -m pip install --upgrade --quiet "huggingface_hub>=0.24.0,<0.25.0"

should_validate_pipeline=0
case "${VERIFY_MODEL_PIPELINE:-auto}" in
  0)
    should_validate_pipeline=0
    ;;
  1)
    should_validate_pipeline=1
    ;;
  *)
    if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
      should_validate_pipeline=1
    fi
    ;;
esac

log "Downloading ${MODEL_ID}@${MODEL_REVISION}"
MODEL_ID="$MODEL_ID" \
MODEL_REVISION="$MODEL_REVISION" \
TARGET_DIR="$TARGET_DIR" \
"$PYTHON_BIN" <<'PY'
import os
from huggingface_hub import snapshot_download

model_id = os.environ["MODEL_ID"]
revision = os.environ["MODEL_REVISION"]
target_dir = os.environ["TARGET_DIR"]

snapshot_download(
    repo_id=model_id,
    revision=revision,
    local_dir=target_dir,
    local_dir_use_symlinks=False,
    allow_patterns=None,
)
PY

if ! MODEL_FORMAT="$(detect_model_format "$TARGET_DIR")"; then
  die "Downloaded model at ${TARGET_DIR} does not contain recognizable MLX or Core ML artifacts (supported: .safetensors, .gguf, .mlx, .mlpackage, .mlmodel, .mlmodelc)"
fi

if [[ "$MODEL_FORMAT" == "coreml" && "$should_validate_pipeline" -eq 1 ]]; then
  log "Core ML package detected; skipping MLX/transformers warm-up."
  should_validate_pipeline=0
fi

UPPER_FORMAT="$(printf '%s' "${MODEL_FORMAT}" | tr '[:lower:]' '[:upper:]')"
log "Bundled ${UPPER_FORMAT} model ready at ${TARGET_DIR}"

if [[ "$should_validate_pipeline" -eq 0 && "${VERIFY_MODEL_PIPELINE:-auto}" != "0" ]]; then
  log "Skipping transformers pipeline warm-up on $(uname -s)/$(uname -m); enable VERIFY_MODEL_PIPELINE=1 on supported hosts."
fi

if [[ "$should_validate_pipeline" -eq 1 ]]; then
  log "Installing transformers pipeline helpers inside ${VENV_DIR} (quietly)"
  "$PYTHON_BIN" -m pip install --upgrade --quiet "transformers>=4.43.0" "sentencepiece>=0.1.99"
  if [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]]; then
    "$PYTHON_BIN" -m pip install --upgrade --quiet "mlx>=0.12.0" "mlx-lm>=0.10.0"
  fi
fi

if [[ "$should_validate_pipeline" -eq 1 ]]; then
  log "Validating MLX weights with runtime helpers"
  MODEL_DIR="$TARGET_DIR" "$PYTHON_BIN" <<'PY'
import json
import os
import sys

model_dir = os.environ["MODEL_DIR"]

PROMPT = "You are a helpful assistant. Who are you?"

def try_mlx_validation() -> bool:
    try:
        from mlx_lm import generate, load
    except Exception:  # pragma: no cover - optional dependency
        return False

    try:
        try:
            model, tokenizer = load(model_dir, tokenizer=model_dir)
        except TypeError:
            model, tokenizer = load(model_dir)

        response = generate(model, tokenizer, PROMPT, max_tokens=64)
    except Exception as exc:  # pragma: no cover - runtime validation only
        raise SystemExit(f"MLX validation failed: {exc}") from exc

    if isinstance(response, (list, tuple)) and response:
        response_text = "".join(str(part) for part in response)
    else:
        response_text = str(response)

    print(json.dumps({
        "backend": "mlx_lm",
        "prompt": PROMPT,
        "response": response_text,
    }, ensure_ascii=False))
    return True

def run_transformers_pipeline() -> None:
    from transformers import pipeline

    messages = [
        {"role": "user", "content": PROMPT},
    ]

    pipe = pipeline(
        "text-generation",
        model=model_dir,
        trust_remote_code=True,
    )

    generation_kwargs = {
        "max_new_tokens": 64,
        "return_full_text": False,
    }
    pad_token_id = getattr(getattr(pipe, "tokenizer", None), "eos_token_id", None)
    if pad_token_id is not None:
        generation_kwargs["pad_token_id"] = pad_token_id

    outputs = pipe(messages, **generation_kwargs)
    print(json.dumps({
        "backend": "transformers",
        "outputs": outputs,
    }, indent=2, ensure_ascii=False))


if try_mlx_validation():
    sys.exit(0)

try:
    run_transformers_pipeline()
except Exception as exc:  # pragma: no cover - runtime validation only
    raise SystemExit(f"Pipeline warm-up failed: {exc}") from exc
PY
fi
