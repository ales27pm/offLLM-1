# Reports & Diagnostics Guide

## Scope & provenance

- Files in this directory are archived outputs from previous iOS doctor/Codex runs (`build-log.txt`, `archive-result.json`, `ResultBundle_unsigned.json`, `resolve-package.json`). Treat them as read-only snapshots unless you rerun the doctor pipeline and commit a complete replacement bundle.【F:reports/build-log.txt†L1-L20】【F:reports/archive-result.json†L1-L40】【F:reports/ResultBundle_unsigned.json†L1-L40】【F:reports/resolve-package.json†L1-L4】
- The canonical way to regenerate diagnostics is via `scripts/dev/doctor.sh` (or `npm run doctor:ios`) followed by `npm run codex:analyze`, which writes fresh reports into `ci-reports/<timestamp>/` and optional `reports/` exports. Avoid hand-editing these artefacts.【F:scripts/dev/doctor.sh†L200-L409】【F:package.json†L22-L27】【F:scripts/codex/lib/analyze.mjs†L11-L55】

## Usage & maintenance

- If you regenerate reports, document the context in your PR and copy the full output set (log, `REPORT.md`, `report_agent.md`, xcresult pointers) instead of editing individual files. The legacy `scripts/dev/commit-reports.sh` helper can publish a chosen timestamp if needed.【F:scripts/dev/doctor.sh†L283-L409】【F:scripts/dev/commit-reports.sh†L22-L76】
- When pruning or rotating old bundles to save space, leave at least one recent snapshot referenced by documentation. If sensitive data must be removed, rerun the doctor workflow with sanitised inputs rather than modifying files in-place.【F:reports/archive-result.json†L1-L40】【F:scripts/dev/doctor.sh†L200-L409】

## Living history

- 2025-09 — Doctor runs now symlink xcresult bundles and summarise heuristics into `root_cause.txt`, producing agent-friendly Markdown in `report_agent.md`. Preserve that structure when updating automation or regenerating artefacts.【F:scripts/dev/doctor.sh†L283-L409】
