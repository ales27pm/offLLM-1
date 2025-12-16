#!/usr/bin/env bash
set -euo pipefail

# This script assumes the Pods directory lives at $PROJECT_ROOT/Pods unless the
# caller exports PODS_ROOT. If your Pods directory is customized, export
# PODS_ROOT before invoking the script so it can locate react-native-contacts.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PODS_DIR="${PODS_ROOT:-$PROJECT_ROOT/Pods}"

if [ ! -d "$PODS_DIR" ]; then
  echo "⚠️ Pods directory not found at $PODS_DIR. If you use a custom location, set the PODS_ROOT environment variable."
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ python3 is required to patch react-native-contacts but was not found on PATH."
  exit 1
fi

if ! python3 - <<'PY' >/dev/null 2>&1; then
import sys
sys.exit(0 if sys.version_info >= (3, 7) else 1)
PY
  PY_VERSION="$(python3 --version 2>/dev/null || echo 'python3 unavailable')"
  echo "❌ python3 3.7 or newer is required to patch react-native-contacts (detected: $PY_VERSION)."
  exit 1
fi

TARGET_FILE="$(python3 - "$PODS_DIR" <<'PY'
import pathlib
import sys

pods_dir = pathlib.Path(sys.argv[1])

# Prefer common layouts before falling back to an exhaustive search. Older
# releases stored the source at Pods/react-native-contacts/ios/RCTContacts.mm
# while modern CocoaPods development pods surface it at
# Pods/Development Pods/react-native-contacts/ios/RCTContacts/RCTContacts.mm.
direct_paths = [
    pods_dir / 'react-native-contacts' / 'ios' / 'RCTContacts.mm',
    pods_dir / 'react-native-contacts' / 'ios' / 'RCTContacts' / 'RCTContacts.mm',
]
for path in direct_paths:
    if path.exists():
        print(path)
        sys.exit(0)

# Fall back to searching the sandbox. Follow symlinks so "Development Pods"
# entries resolve into the node_modules workspace when necessary.
candidates = []
for candidate in pods_dir.rglob('RCTContacts.mm'):
    try:
        resolved = candidate.resolve()
    except FileNotFoundError:
        resolved = candidate
    candidate_str = str(candidate)
    resolved_str = str(resolved)
    if 'react-native-contacts' not in candidate_str and 'react-native-contacts' not in resolved_str:
        continue
    if 'Headers' in candidate_str:
        continue
    candidates.append((len(candidate_str), candidate_str, candidate))

if candidates:
    candidates.sort()
    print(candidates[0][2])
PY
)"
TARGET_FILE="${TARGET_FILE%$'\r'}"

if [ -z "$TARGET_FILE" ] || [ ! -f "$TARGET_FILE" ]; then
  echo "ℹ️ react-native-contacts pod not found under $PODS_DIR; skipping orientation patch."
  exit 0
fi

python3 - "$TARGET_FILE" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
text = path.read_text()
updated = False
changes = []

if '#import <ImageIO/CGImageProperties.h>' not in text:
    marker = '#import <Photos/Photos.h>'
    if marker in text:
        text = text.replace(
            marker,
            marker + '\n#import <ImageIO/CGImageProperties.h>',
            1,
        )
        updated = True
        changes.append('import')

if 'requestImageDataForAsset:' in text:
    text = text.replace(
        'requestImageDataForAsset:',
        'requestImageDataAndOrientationForAsset:',
    )
    updated = True
    changes.append('requestImageDataAndOrientationForAsset')

handler_pattern = re.compile(
    r'resultHandler:\^\(\s*NSData \* _Nullable data,\s*(?:__unused\s+)?NSString \* _Nullable dataUTI,\s*(?:__unused\s+)?UIImageOrientation\s+orientation,\s*(?:__unused\s+)?NSDictionary \* _Nullable info\s*\)'
)
if handler_pattern.search(text):
    text = handler_pattern.sub(
        'resultHandler:^(NSData * _Nullable data, __unused NSString * _Nullable dataUTI, __unused CGImagePropertyOrientation orientation, __unused NSDictionary * _Nullable info)',
        text,
    )
    updated = True
    changes.append('resultHandler signature')

orientation_pattern = re.compile(r'UIImageOrientation(?![A-Za-z0-9_])')
if orientation_pattern.search(text):
    text = orientation_pattern.sub('CGImagePropertyOrientation', text)
    updated = True
    changes.append('enum type')

if updated:
    path.write_text(text)
    summary = ', '.join(dict.fromkeys(changes))
    if summary:
        summary = f' ({summary})'
    print(f'✅ Patched {path}{summary}.')
else:
    print(f'ℹ️ {path} already uses CGImagePropertyOrientation-compatible APIs; no changes made.')
PY



