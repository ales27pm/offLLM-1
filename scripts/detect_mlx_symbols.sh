#!/usr/bin/env bash
set -euo pipefail

# Where Xcode places SPM checkouts on CI (already in your logs):
#   $DERIVED_DATA/SourcePackages/checkouts/mlx-swift-examples
ROOT="${1:-"${DERIVED_DATA:-$HOME/Library/Developer/Xcode/DerivedData}/SourcePackages/checkouts"}"

# Fallback: search anywhere under the repo for mlx Swift module interfaces
CANDIDATES=()
if [ -d "$ROOT" ]; then
  CANDIDATES+=("$ROOT/mlx-swift-examples")
fi
CANDIDATES+=($(git ls-files | grep -E 'mlx-swift-examples|mlx-swift$' | xargs -I{} dirname {} | sort -u || true))

HAS_FACTORY=0
HAS_GENCONFIG=0

scan_for_symbol () {
  local dir="$1"; local symbol="$2"
  # Look for symbol mentions in .swiftinterface or Sources .swift (cheap heuristic)
  if grep -R --include='*.swiftinterface' --include='*.swift' -n "$symbol" "$dir" >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

for base in "${CANDIDATES[@]}"; do
  [ -d "$base" ] || continue
  # MLX LLM lives under mlx-swift-examples/MLXLLM or similar
  if scan_for_symbol "$base" 'struct LLMModelFactory' ; then HAS_FACTORY=1; fi
  if scan_for_symbol "$base" 'struct GenerationConfig' ; then HAS_GENCONFIG=1; fi
done

OUT="ios/Config/Auto/MLXFlags.xcconfig"
mkdir -p "$(dirname "$OUT")"

FLAGS="SWIFT_ACTIVE_COMPILATION_CONDITIONS = \$(inherited)"
if [ "$HAS_FACTORY" -eq 1 ]; then
  FLAGS="$FLAGS MLX_FACTORY_LOADER"
fi
if [ "$HAS_GENCONFIG" -eq 1 ]; then
  FLAGS="$FLAGS MLX_GENCONFIG"
fi

echo "$FLAGS" > "$OUT"
echo "[detect_mlx_symbols] Wrote $OUT => $FLAGS"



