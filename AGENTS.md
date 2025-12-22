# OffLLM Contributor Guide

## Runtime snapshot

- `AgentOrchestrator.run` is the single entry point: it retrieves long- and short-term context, builds the first prompt, routes any parsed `TOOL_CALL` directives, executes the requested tools under tracer instrumentation, and then issues a final LLM call before persisting the exchange.【F:src/core/AgentOrchestrator.js†L27-L190】
- Prompt construction and tool routing stay deterministic through `PromptBuilder`, `ToolHandler`, and `WorkflowTracer`; changes to prompt wording, argument parsing, or step logging must preserve ordering and structured telemetry so caching and tests remain stable.【F:src/core/prompt/PromptBuilder.js†L27-L70】【F:src/core/tools/ToolHandler.js†L35-L198】【F:src/core/workflows/WorkflowTracer.js†L24-L116】
- Memory is composed from `MemoryManager`, `VectorIndexer`, `Retriever`, and `HistoryService`. Keep embeddings, sparse-attention re-ranking, and bounded history updates in sync whenever you alter retrieval or storage semantics.【F:src/core/memory/MemoryManager.js†L8-L34】【F:src/core/memory/services/VectorIndexer.js†L1-L25】【F:src/core/memory/services/Retriever.js†L1-L35】【F:src/core/memory/services/HistoryService.js†L1-L16】
- `ContextEngineer` orchestrates device-aware token budgets, hierarchical summarisation, sparse retrieval fallbacks, and prioritisation logic. Budget or heuristic changes must remain deterministic because downstream prompt assembly assumes consistent token accounting.【F:src/services/contextEngineer.js†L16-L423】
- `LLMService` owns model download/bridging, plugin enablement, KV-cache lifecycle, embeddings, and adaptive quantisation. New surfaces must respect its load → generate/execute → metric update contract so plugins like sparse attention can continue to wrap `generate` safely.【F:src/services/llmService.js†L14-L351】
- Plugins and advanced tools are wired through `PluginManager`, `registerLLMPlugins`, and `src/architecture/toolSystem.js`. When extending automation, reuse their hook/override plumbing and execution analytics instead of introducing parallel registries.【F:src/architecture/pluginManager.js†L1-L228】【F:src/architecture/pluginSetup.js†L1-L30】【F:src/architecture/toolSystem.js†L1-L200】
- Native/runtime tools auto-register via `src/core/tools/ToolRegistry.js`, pulling either the iOS TurboModule implementations or Android stubs. New platform exports must remain side-effect free and expose `{ name, execute, description, parameters }` metadata so prompt generation stays accurate.【F:src/core/tools/ToolRegistry.js†L5-L38】【F:src/tools/iosTools.js†L1-L120】【F:src/tools/androidTools.js†L1-L15】

## Workflow expectations

- Before committing, run the project quality gates locally: `npm test`, `npm run lint`, and `npm run format:check`. They are the contract for Jest, ESLint, and Prettier coverage respectively.【F:package.json†L6-L29】
- Keep `docs/agent-architecture.md` aligned with any runtime, tooling, or native-surface changes you introduce. The guide already cites the orchestration, memory, service, plugin, and native bridge implementations and should continue to mirror the code you touch.【F:docs/agent-architecture.md†L3-L118】
- When adding orchestration or service features, extend or update the matching Jest suites (`toolHandler`, `workflowTracer`, `vectorMemory`, `llmService`, etc.) so regressions surface automatically in CI.【F:**tests**/toolHandler.test.js†L1-L76】【F:**tests**/workflowTracer.test.js†L1-L40】【F:**tests**/vectorMemory.test.js†L1-L45】【F:**tests**/llmService.test.js†L1-L33】

## Diagnostics & evidence

- `scripts/dev/doctor.sh` reproduces the iOS CI pipeline, generating timestamped folders under `ci-reports/` with `REPORT.md`, `report_agent.md`, `xcodebuild.log`, and xcresult snapshots. Capture and attach those artefacts (or summaries) to PRs when you debug native builds instead of hand-written notes.【F:scripts/dev/doctor.sh†L200-L409】
- Use the Codex CLI (`npm run codex:analyze`) to reprocess logs or xcresult bundles into structured Markdown/JSON reports under `reports/`; it normalises heuristics across contributors.【F:package.json†L22-L24】【F:scripts/codex/index.mjs†L1-L37】【F:scripts/codex/lib/analyze.mjs†L11-L55】
- The checked-in `reports/` directory reflects the latest archived diagnostics (`build-log.txt`, `archive-result.json`, `ResultBundle_unsigned.json`, `resolve-package.json`). Treat them as read-only evidence unless you regenerate the full bundle via the doctor or Codex flows.【F:reports/build-log.txt†L1-L20】【F:reports/archive-result.json†L1-L40】【F:reports/ResultBundle_unsigned.json†L1-L40】【F:reports/resolve-package.json†L1-L4】

## Coordination & documentation

- When platform metadata changes (e.g., Info.plist keys, deployment targets, MLX package versions), update the corresponding iOS project files alongside runtime expectations to avoid drift between native builds and agent behaviour.【F:ios/MyOfflineLLMApp/Info.plist†L5-L56】【F:ios/project.yml†L1-L120】
- Prefer reusing shared tooling helpers (`tools/xcresult-parser.js`, `tools/util.mjs`) from shell or Node scripts so xcresult parsing, legacy-flag detection, and subprocess handling stay consistent across automation entry points.【F:tools/xcresult-parser.js†L1-L185】【F:tools/util.mjs†L3-L27】

## Living history

- 2025-09 — The Codex CLI became the canonical way to turn doctor artefacts into Markdown/JSON, keeping local and CI diagnostics aligned; reach for it before hand-curating summaries.【F:scripts/codex/index.mjs†L15-L35】【F:scripts/codex/lib/analyze.mjs†L11-L55】
- 2025-09 — The doctor workflow now symlinks xcresult bundles, scrapes heuristics into `root_cause.txt`, and emits agent-friendly reports—preserve those heuristics when adjusting build automation.【F:scripts/dev/doctor.sh†L283-L409】
