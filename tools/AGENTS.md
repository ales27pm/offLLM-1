# Build Tooling Guide

## Scope & responsibilities

- Utilities in this directory back the doctor workflow and CI diagnostics. They expose small ESM modules—`util.mjs` for structured shell execution and `xcresult-parser.js` for xcresult inspection—that scripts import to normalise subprocess handling and diagnostics.【F:tools/util.mjs†L1-L27】【F:tools/xcresult-parser.js†L1-L175】
- Keep modules side-effect free so they can be required from CLI entry points and unit tests. Any executable behaviour should stay behind the `process.argv` guard at the bottom of the file, mirroring the xcresult parser’s pattern.【F:tools/xcresult-parser.js†L133-L185】

## Authoring guidance

- Extend `util.mjs` instead of scattering bespoke subprocess wrappers—`sh()` already returns `{ code, stdout, stderr }` and preserves underlying errors for heuristics to inspect.【F:tools/util.mjs†L3-L17】
- When parsing xcresult output, reuse `determineLegacyFlagState`, `isLegacyUnsupportedMessage`, and `getValues` so you respect Apple’s `_values` arrays and the changing `--legacy` support across toolchains.【F:tools/xcresult-parser.js†L20-L169】 Document new traversal helpers with comments describing the data shape.
- Treat legacy Xcode compatibility as a first-class requirement: the parser intentionally retries with and without `--legacy` and picks the most informative error message; keep that ordering intact when adding new logic.【F:tools/xcresult-parser.js†L22-L133】

## Operational workflow

- Scripts under `scripts/` should import these helpers rather than duplicating parsing or shell logic. If you need additional xcresult fields or shell semantics, add them here, add focused unit coverage, and update the dependent automation in one commit for traceability.【F:scripts/ci/build_report.py†L1-L200】【F:scripts/dev/doctor.sh†L277-L339】
- Keep exports ESM-friendly (named exports, no CommonJS interop) so Node 18+ runners and Jest can consume them without extra tooling.【F:tools/xcresult-parser.js†L1-L175】

## Dynamic feedback loop

- Capture xcresult schema changes or parsing edge cases in this guide’s living history (and reference the PR or log that proved it) so the lesson is easy to trace without relying on the retired report pipeline.【F:tools/xcresult-parser.js†L1-L175】【F:Steps.md†L1-L108】
- When new diagnostics consumers appear (dashboards, CI comments, etc.), document how they ingest parser output and update both this guide and the calling scripts so downstream expectations stay aligned.【F:scripts/AGENTS.md†L1-L54】

### Living history

- 2025-02 – The xcresult parser’s legacy-flag detection prevented CI regressions when Xcode removed `--legacy` support on certain runners; maintain the retry ordering and failure-selection logic when refactoring.【F:tools/xcresult-parser.js†L22-L133】
- 2025-02 – Structured shell wrappers in `util.mjs` surfaced non-zero exit codes during earlier investigations—reuse and extend them instead of shelling out ad hoc.【F:tools/util.mjs†L3-L17】

### Session reflection

- Before ending the session, save the current run's successes and errors so the next session can build on what worked and avoid repeating mistakes.
