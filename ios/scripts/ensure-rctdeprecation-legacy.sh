#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANON="${SCRIPT_DIR}/../Pods/Headers/Public/RCTDeprecation/module.modulemap"
LEGACY="${SCRIPT_DIR}/../Pods/Headers/Public/RCTDeprecation/RCTDeprecation.modulemap"
FALLBACK="${SCRIPT_DIR}/../Config/RCTDeprecation.modulemap"

if [ ! -f "${CANON}" ] && [ -f "${FALLBACK}" ]; then
  mkdir -p "$(dirname "${CANON}")"
  cp "${FALLBACK}" "${CANON}"
  echo "[ensure] Restored canonical module.modulemap from fallback"
fi

if [ -f "${CANON}" ]; then
  if [ ! -e "${LEGACY}" ]; then
    ln -sf "${CANON}" "${LEGACY}" 2>/dev/null || cp "${CANON}" "${LEGACY}"
    echo "[ensure] Created legacy RCTDeprecation.modulemap"
  fi
else
  echo "[ensure] Canonical module.modulemap missing at ${CANON}"
  exit 65
fi


