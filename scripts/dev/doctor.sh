#!/usr/bin/env bash
# Local iOS build + diagnosis runner
# Reproduces CI steps, generates REPORT.md and report_agent.md you can commit.
# Usage:
#   bash scripts/dev/doctor.sh
#   SCHEME=monGARS CONFIGURATION=Debug bash scripts/dev/doctor.sh
#   NO_INSTALL=1 SKIP_XCODEGEN=1 bash scripts/dev/doctor.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
XCODE_ENV_HELPER="$ROOT_DIR/scripts/lib/xcode_env.sh"
ENV_FILE="$ROOT_DIR/.env"
DEFAULT_ENV_FILE="$ROOT_DIR/.env.default"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
elif [ -f "$DEFAULT_ENV_FILE" ]; then
  echo "ℹ️ No .env file found; loading defaults from $DEFAULT_ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$DEFAULT_ENV_FILE"
  set +a
fi

# shellcheck source=../lib/xcode_env.sh
source "$XCODE_ENV_HELPER"
sanitize_xcode_env

### ───────────────────────────────────────────────────────────────────────────────────
### Config (defaults can be overridden via env)
### ───────────────────────────────────────────────────────────────────────────────────
SCHEME="${SCHEME:-monGARS}"
CONFIGURATION="${CONFIGURATION:-Release}"
BUILD_DIR="${BUILD_DIR:-build}"
IOS_DIR="${IOS_DIR:-ios}"
REPORT_ROOT="${REPORT_ROOT:-ci-reports}"

# If you want a Simulator build locally set:
#   DESTINATION="platform=iOS Simulator,name=iPhone 16 Pro"
DESTINATION="${DESTINATION:-generic/platform=iOS}"

# Speed toggles
NO_INSTALL="${NO_INSTALL:-0}"     # 1 = don’t run bundle install / pod install
SKIP_XCODEGEN="${SKIP_XCODEGEN:-0}"  # 1 = don’t run xcodegen generate

# CI parity toggles
RCT_NEW_ARCH_ENABLED="${RCT_NEW_ARCH_ENABLED:-1}"
USE_HERMES="${USE_HERMES:-true}"

### ───────────────────────────────────────────────────────────────────────────────────
### Helpers
### ───────────────────────────────────────────────────────────────────────────────────
 die() { echo "❌ $*" >&2; exit 1; }
 log() { echo "▶ $*"; }
check_tool() { command -v "$1" >/dev/null 2>&1 || die "Missing tool: $1"; }

xcresult_supports_legacy_flag() {
  case "${XCRESULT_SUPPORTS_LEGACY:-}" in
    yes)
      return 0
      ;;
    no|unknown)
      return 1
      ;;
  esac

  if ! command -v xcrun >/dev/null 2>&1; then
    XCRESULT_SUPPORTS_LEGACY="unknown"
    return 1
  fi

  local help_output=""
  if help_output="$(xcrun xcresulttool get --help 2>&1)"; then
    if printf '%s' "$help_output" | grep -qi -- '--legacy'; then
      XCRESULT_SUPPORTS_LEGACY="yes"
      return 0
    fi
    XCRESULT_SUPPORTS_LEGACY="no"
    return 1
  fi

  if printf '%s' "$help_output" | grep -qi -- '--legacy'; then
    XCRESULT_SUPPORTS_LEGACY="yes"
    return 0
  fi

  XCRESULT_SUPPORTS_LEGACY="unknown"
  return 1
}

legacy_error_indicates_removed() {
  local message="$1"
  if [ -z "$message" ]; then
    return 1
  fi

  local lower
  lower="$(printf '%s' "$message" | LC_ALL=C tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    *--legacy*) ;;
    *) return 1 ;;
  esac

  local token
  for token in \
    "unknown option" \
    "unrecognized option" \
    "invalid option" \
    "invalid argument" \
    "not supported" \
    "no longer supported" \
    "unsupported option" \
    "does not support" \
    "has been removed" \
    "was removed" \
    "removed in" \
    "not a valid option"; do
    if [[ "$lower" == *"$token"* ]]; then
      return 0
    fi
  done

  return 1
}

run_xcresulttool_json() {
  local bundle="$1"
  local output="$2"

  if [ ! -d "$bundle" ]; then
    return 1
  fi
  if ! command -v xcrun >/dev/null 2>&1; then
    return 1
  fi

  local tmp_err
  tmp_err="$(mktemp)"
  local best_err=""
  local variants=()

  xcresult_supports_legacy_flag || true
  case "${XCRESULT_SUPPORTS_LEGACY:-unknown}" in
    no)
      variants=("without" "with")
      ;;
    yes)
      variants=("with" "without")
      ;;
    *)
      variants=("with" "without")
      ;;
  esac

  for variant in "${variants[@]}"; do
    if [ "$variant" = "with" ]; then
      if xcrun xcresulttool get --format json --legacy --path "$bundle" \
        >"$output" 2>"$tmp_err"; then
        rm -f "$tmp_err"
        return 0
      fi
    else
      if xcrun xcresulttool get --format json --path "$bundle" \
        >"$output" 2>"$tmp_err"; then
        rm -f "$tmp_err"
        return 0
      fi
    fi

    local err=""
    err="$(cat "$tmp_err" 2>/dev/null)"
    rm -f "$output" || true
    if [ -n "$err" ]; then
      if [ -z "$best_err" ]; then
        best_err="$err"
      elif legacy_error_indicates_removed "$best_err" && ! legacy_error_indicates_removed "$err"; then
        best_err="$err"
      fi
    fi
  done

  if [ -n "$best_err" ]; then
    printf '%s\n' "$best_err" >&2 || true
  fi
  rm -f "$tmp_err"
  return 1
}

 PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
 cd "$PROJECT_ROOT"

 [ -d "$IOS_DIR" ] || die "Cannot find $IOS_DIR at $PROJECT_ROOT/$IOS_DIR"
 check_tool xcodebuild
 check_tool xcrun
 check_tool ruby
 check_tool node

 TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
 REPORT_DIR="${REPORT_ROOT}/${TIMESTAMP}"
 mkdir -p "$REPORT_DIR"

### ───────────────────────────────────────────────────────────────────────────────────
### Install / Generate
### ───────────────────────────────────────────────────────────────────────────────────
 if [[ "$SKIP_XCODEGEN" != "1" ]]; then
   log "Generating Xcode project with xcodegen…"
   check_tool xcodegen
   xcodegen generate --spec "$IOS_DIR/project.yml"
 else
   log "Skipping xcodegen (SKIP_XCODEGEN=1)"
 fi

 if [[ "$NO_INSTALL" != "1" ]]; then
   log "Bundler config path (vendor/bundle)…"
   (cd "$IOS_DIR" && bundle config set path vendor/bundle)

   log "bundle install…"
   (cd "$IOS_DIR" && bundle install)

  log "pod install (bundler)…"
  (cd "$IOS_DIR" && bundle exec pod update hermes-engine --no-repo-update && bundle exec pod install --repo-update)
 else
   log "Skipping installs (NO_INSTALL=1)"
 fi

 log "Set NODE_BINARY for Xcode scripts…"
 rm -f "$IOS_DIR/.xcode.env.local" || true
 printf 'export NODE_BINARY="%s"\n' "$(command -v node)" > "$IOS_DIR/.xcode.env"

### ───────────────────────────────────────────────────────────────────────────────────
### Optional scrub: Hermes script phases (same as CI)
### ───────────────────────────────────────────────────────────────────────────────────
 if [[ -f "scripts/strip_hermes_phase.rb" ]]; then
   log "Scrubbing Hermes 'Replace Hermes' phases in Pods + app projects…"
   (cd "$IOS_DIR" && bundle exec ruby ../scripts/strip_hermes_phase.rb Pods/Pods.xcodeproj ../ios/monGARS.xcodeproj) || true
 else
   log "strip_hermes_phase.rb not found; continuing…"
 fi

### ───────────────────────────────────────────────────────────────────────────────────
### Build
### ───────────────────────────────────────────────────────────────────────────────────
 mkdir -p "$BUILD_DIR"

 log "Resolve SPM dependencies…"
 xcodebuild -resolvePackageDependencies \
   -workspace "$IOS_DIR/monGARS.xcworkspace" \
   -scheme "$SCHEME" -UseModernBuildSystem=YES || true

 log "Archive (or build for simulator) with logs to $BUILD_DIR/xcodebuild.log…"
 {
   if [[ "$DESTINATION" == generic/* ]]; then
     # Device archive (unsigned)
     xcodebuild clean archive \
       -workspace "$IOS_DIR/monGARS.xcworkspace" \
       -scheme "$SCHEME" \
       -configuration "$CONFIGURATION" \
       -destination "$DESTINATION" \
       -archivePath "$BUILD_DIR/monGARS.xcarchive" \
       -resultBundlePath "$BUILD_DIR/monGARS.xcresult" \
       -UseModernBuildSystem=YES \
       CODE_SIGN_IDENTITY="" CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=NO
   else
     # Simulator build
     xcodebuild \
       -workspace "$IOS_DIR/monGARS.xcworkspace" \
       -scheme "$SCHEME" \
       -configuration "$CONFIGURATION" \
       -sdk iphonesimulator \
       -destination "$DESTINATION" \
       -UseModernBuildSystem=YES \
       CODE_SIGNING_ALLOWED=NO \
       clean build
   fi
 } | tee "$BUILD_DIR/xcodebuild.log"

### ───────────────────────────────────────────────────────────────────────────────────
### Diagnose: summarize xcodebuild.log + parse .xcresult → write reports
### ───────────────────────────────────────────────────────────────────────────────────
 LOG="$BUILD_DIR/xcodebuild.log"
XCRESULT="$BUILD_DIR/monGARS.xcresult"

 cp "$LOG" "$REPORT_DIR/" 2>/dev/null || true
 if [[ -d "$XCRESULT" ]]; then
   log "Copying xcresult bundle to report dir…"
   # xcresult can be huge; copy the JSON summary + keep a symlink to the original bundle
   (cd "$REPORT_DIR" && ln -sf "../../$XCRESULT" "monGARS.xcresult")
 fi

 # Extract issues from xcresult (if present)
 XC_SUMMARY_JSON="$REPORT_DIR/xcresult_summary.json"
if [[ -d "$XCRESULT" ]]; then
  log "Extracting issues JSON from xcresult…"
  run_xcresulttool_json "$XCRESULT" "$XC_SUMMARY_JSON" || true
fi

 # Grep errors/warnings from build log
 LOG_ERRORS_TXT="$REPORT_DIR/log_errors.txt"
 LOG_WARNINGS_TXT="$REPORT_DIR/log_warnings.txt"
 grep -iE "error: |Command PhaseScriptExecution failed|Internal inconsistency error|exit code [1-9]" "$LOG" > "$LOG_ERRORS_TXT" || true
 grep -iE "warning: " "$LOG" > "$LOG_WARNINGS_TXT" || true

 # Make a concise root-cause guess
 ROOT_CAUSE="$REPORT_DIR/root_cause.txt"
 {
   echo "Heuristics (may be noisy):"
   if grep -q "Replace Hermes" "$LOG"; then
     echo "- Hermes replacement script still present or referenced."
   fi
   if grep -qi "Internal inconsistency error: never received target ended message" "$LOG"; then
     echo "- XCBuild race/parallelization hiccup (try clean DerivedData or re-run)."
   fi
   if grep -qi "IPHONEOS_DEPLOYMENT_TARGET is set to 9.0" "$LOG"; then
     echo "- A Pod subtarget sets iOS 9.0; consider post_install build setting bump (>=12)."
   fi
   if grep -qiE "Create Symlinks to Header Folders" "$LOG"; then
     echo "- Numerous [CP] phases with no I/O (noise); already silenced by Podfile but still logged as notes."
   fi
 } > "$ROOT_CAUSE" || true

 # REPORT.md
 REPORT_MD="$REPORT_DIR/REPORT.md"
 {
   echo "# iOS CI Diagnosis"
   echo
   echo "Generated: $(date)"
   echo
   echo "## Most likely root cause"
   echo
   echo '```'
   cat "$ROOT_CAUSE" || true
   echo '```'
   echo
   echo "## Top XCResult issues"
   if [[ -f "$XC_SUMMARY_JSON" ]]; then
     echo
     echo "Parsed from \`monGARS.xcresult\`:"
     echo
     # Pull out topDiagnostics if present (keep it short)
     /usr/bin/python3 - "$XC_SUMMARY_JSON" <<'PY' || true
import json,sys, itertools
p=sys.argv[1]
try:
  j=json.load(open(p))
except Exception:
  sys.exit(0)
def find_issues(obj):
  if isinstance(obj, dict):
    for k,v in obj.items():
      if k in ("issues","errors","warnings") and isinstance(v, dict):
        yield from [("errors", v.get("errorSummaries",[])), ("warnings", v.get("warningSummaries",[]))]
      else:
        yield from find_issues(v)
  elif isinstance(obj, list):
    for x in obj: yield from find_issues(x)
tops=list(find_issues(j))
printed=0
for kind,arr in tops:
  if not arr: continue
  print(f"### {kind.capitalize()}")
  for item in itertools.islice(arr, 0, 20):
    title=(item.get('title','') or item.get('_value','')).strip()
    if title:
      print(f"- {title}")
      printed+=1
  print()
if printed==0:
  print("_No issue summaries found in xcresult JSON._")
PY
   else
     echo
     echo "_No .xcresult bundle found or parse failed; see raw log instead._"
   fi
   echo
   echo "## Pointers"
   echo "- Full log: \`$LOG\`"
   if [[ -d "$XCRESULT" ]]; then
     echo "- Result bundle: \`$XCRESULT\`"
   fi
 } > "$REPORT_MD"

 # report_agent.md (trimmed form for your agent)
 AGENT_MD="$REPORT_DIR/report_agent.md"
 {
   echo "# CI Report (Agent-friendly)"
   echo
   echo "## Root cause (heuristic)"
   echo
   sed 's/^/- /' "$ROOT_CAUSE" 2>/dev/null || true
   echo
   echo "## Errors (from xcodebuild.log)"
   echo
   sed -e 's/^/    /' "$LOG_ERRORS_TXT" 2>/dev/null | head -n 400 || echo "    (none)"
   echo
   echo "## Warnings (from xcodebuild.log)"
   echo
   sed -e 's/^/    /' "$LOG_WARNINGS_TXT" 2>/dev/null | head -n 200 || echo "    (none)"
 } > "$AGENT_MD"

 log "Reports written:"
 log "  - $REPORT_MD"
 log "  - $AGENT_MD"
 log "  - $LOG"
 [[ -d "$XCRESULT" ]] && log "  - $XCRESULT (symlinked under $REPORT_DIR)"

 echo "✅ Done."



