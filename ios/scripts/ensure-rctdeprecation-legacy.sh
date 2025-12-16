#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANON="${SCRIPT_DIR}/../Pods/Headers/Public/RCTDeprecation/module.modulemap"
LEGACY="${SCRIPT_DIR}/../Pods/Headers/Public/RCTDeprecation/RCTDeprecation.modulemap"

if [ -f "${CANON}" ]; then
  if [ ! -e "${LEGACY}" ]; then
    ln -sf "${CANON}" "${LEGACY}" 2>/dev/null || cp "${CANON}" "${LEGACY}"
    echo "[ensure] Created legacy RCTDeprecation.modulemap"
  fi
else
  echo "[ensure] Canonical module.modulemap missing at ${CANON}"
  exit 65
fi



