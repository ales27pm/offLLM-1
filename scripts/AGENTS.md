# Automation Scripts Guide

## Scope & structure

- `scripts/dev/doctor.sh` reproduces the iOS CI flow: loads env defaults, runs xcodegen/pod install, strips Hermes phases, archives the build, captures logs, and writes `REPORT.md`/`report_agent.md` plus xcresult summaries under `ci-reports/<timestamp>/`. Capture relevant artefacts when sharing diagnostics.【F:scripts/dev/doctor.sh†L200-L409】
- CI-facing helpers live under `scripts/ci/`; for example, `build_report.py` parses `xcodebuild.log` and xcresult bundles, retrying legacy flags when necessary and emitting human- and agent-readable reports without failing the workflow.【F:scripts/ci/build_report.py†L1-L120】
- Supporting utilities include `scripts/ios_doctor.sh` (cleans DerivedData and exposes the workspace path), `scripts/detect_mlx_symbols.sh` (scans MLX Swift interfaces to write `MLXFlags.xcconfig`), and `scripts/dev/commit-reports.sh` (publishes doctor outputs). Keep their responsibilities narrow and composable.【F:scripts/ios_doctor.sh†L1-L39】【F:scripts/detect_mlx_symbols.sh†L1-L47】【F:scripts/dev/commit-reports.sh†L22-L76】

## Authoring guidance

- Default new Bash scripts to `set -euo pipefail`, surface descriptive `die`/`log` helpers, and reuse shared logic instead of duplicating heuristics—`doctor.sh` already exposes xcresult probing, log scraping, and report generation patterns.【F:scripts/dev/doctor.sh†L1-L409】
- Prefer delegating reusable parsing or subprocess work to the Node utilities in `tools/` (`xcresult-parser.js`, `util.mjs`) rather than reimplementing shell logic in multiple places.【F:tools/xcresult-parser.js†L1-L185】【F:tools/util.mjs†L3-L27】
- Document new environment toggles and expectations in script headers so contributors can reproduce CI behaviour locally without spelunking through code.【F:scripts/dev/doctor.sh†L1-L55】

## Operational workflow

- Use `npm run doctor:ios` (or the fast/simulator variants) to capture a fresh CI reproduction, then feed the results through `npm run codex:analyze` if you need Markdown/JSON summaries in `reports/`. Upload artefacts manually—automated publishing has been retired.【F:package.json†L22-L27】【F:scripts/dev/doctor.sh†L200-L409】【F:scripts/codex/lib/analyze.mjs†L11-L55】
- If you need to commit diagnostics, use `scripts/dev/commit-reports.sh` to copy a specific timestamp into the repo while keeping the working tree clean, or document why you deviated from the standard flow.【F:scripts/dev/commit-reports.sh†L22-L76】
- Mirror new automation behaviour in the documentation guides (`docs/agent-architecture.md`, root `AGENTS.md`) so runtime expectations and troubleshooting steps remain aligned.【F:docs/agent-architecture.md†L15-L118】【F:AGENTS.md†L1-L40】

## Living history

- 2025-09 — `doctor.sh` now symlinks xcresult bundles, writes heuristic summaries to `root_cause.txt`, and emits agent-friendly Markdown; preserve those heuristics when refactoring.【F:scripts/dev/doctor.sh†L283-L409】
- 2025-09 — `detect_mlx_symbols.sh` updates `ios/Config/Auto/MLXFlags.xcconfig` automatically, preventing stale compilation flags during CI; reuse the same detection logic for future MLX changes.【F:scripts/detect_mlx_symbols.sh†L1-L47】
