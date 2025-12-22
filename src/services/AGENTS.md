# Services Guide

## LLM runtime

- `llmService` owns model download, native/TurboModule bridging, plugin enablement, KV-cache lifecycle, embeddings, performance metrics, and adaptive quantisation. New entry points must preserve the `loadConfiguredModel → generate → adjustQuantization` flow so plugins can wrap or override generation safely.【F:src/services/llmService.js†L14-L351】
- Built-in plugins (`sparseAttention`, `adaptiveQuantization`) are registered through `registerLLMPlugins`; follow the same pattern for new plugins so enable/disable can restore original methods cleanly.【F:src/architecture/pluginSetup.js†L1-L30】【F:src/architecture/pluginManager.js†L23-L204】
- The dependency injector seeds device profile, performance metrics, and KV cache state for plugin access. Register additional shared services through the injector instead of introducing globals.【F:src/architecture/dependencyInjector.js†L1-L24】【F:src/architecture/diSetup.js†L1-L5】

## Context planning

- `ContextEngineer` coordinates dynamic token budgeting, hierarchical summarisation, sparse retrieval fallbacks, and device-aware prioritisation. Keep its heuristics deterministic and update documentation/tests when you tweak budgeting or sparse-attention thresholds.【F:src/services/contextEngineer.js†L16-L423】
- Memory integration (vector store indexing/retrieval plus bounded history) depends on the same embeddings used by `llmService`. Update both layers together if you change metadata or storage formats to avoid desynchronised recall.【F:src/core/memory/MemoryManager.js†L8-L34】【F:src/services/llmService.js†L116-L207】

## Content and search services

- `ReadabilityService` fetches, cleans, and caches article content with metadata; expose informative errors so upstream tools can surface failures without losing context.【F:src/services/readabilityService.js†L1-L159】
- `SearchService.performSearchWithContentExtraction` wraps multiple providers, applies caching/rate limiting, and enriches results with readability output. Keep its payload shape (`{ success, contentExtracted, ... }`) stable so tool consumers can rely on consistent fields.【F:src/services/webSearchService.js†L1-L65】

## Reasoning utilities

- `TreeOfThoughtReasoner` implements multi-branch reasoning, candidate evaluation, and explanation synthesis on top of `llmService.generate`. Adjust branching limits, evaluation thresholds, or explanation output in tandem with documentation and tests.【F:src/services/treeOfThought.js†L3-L191】

## Tests & coordination

- Extend `llmService.test.js`, `toolHandler.test.js`, and `vectorMemory.test.js` whenever you modify service contracts to ensure orchestration keeps its guarantees.【F:**tests**/llmService.test.js†L1-L33】【F:**tests**/toolHandler.test.js†L1-L76】【F:**tests**/vectorMemory.test.js†L1-L45】
- Reflect service-layer changes in `docs/agent-architecture.md` so the external narrative remains authoritative for plugins, context planning, and tooling integrations.【F:docs/agent-architecture.md†L15-L118】
