# Architecture & Plugins Guide

## Plugin lifecycle

- `PluginManager` handles registration, hook execution, overrides, and module patch bookkeeping. Route new behaviour through `registerPlugin` and `enablePlugin` so `_replaceModuleFunction` can capture and restore originals cleanly; only dotted module paths should be patched globally.【F:src/architecture/pluginManager.js†L1-L204】
- `registerLLMPlugins` shows how to add built-in overrides for the LLM service. Follow the same pattern when shipping new plugins (e.g., hardware-aware ones) so they enable immediately after the model loads and remain easy to disable.【F:src/architecture/pluginSetup.js†L1-L30】【F:src/services/llmService.js†L41-L187】

## Dependency injection & shared state

- Use the dependency injector to expose shared services (device profile, performance metrics, KV cache) instead of introducing globals. That keeps plugin access consistent across native platforms.【F:src/architecture/dependencyInjector.js†L1-L24】【F:src/architecture/diSetup.js†L1-L5】

## Advanced tool system

- `src/architecture/toolSystem.js` provides a richer registry with parameter defaults, validation, execution history, and analytics. Reuse its helpers (`applyParameterDefaults`, `validateParameters`, `extractResultAnalytics`) when exposing new Node-side tools so telemetry and error reporting stay consistent.【F:src/architecture/toolSystem.js†L1-L200】
- Built-in analytics capture `usageCount`, execution summaries, and error states. Preserve that accounting when adding new execution paths or retries so downstream automation retains accurate telemetry.【F:src/architecture/toolSystem.js†L77-L141】

## Coordination

- Document plugin or tool-system changes in the architecture guide and extend relevant tests so external docs mirror the runtime behaviour.【F:docs/agent-architecture.md†L17-L118】【F:**tests**/toolHandler.test.js†L1-L76】
