# Core Runtime Guide

## Orchestration
- `AgentOrchestrator` is the runtime entry point: it assembles long- and short-term context, builds the initial prompt, executes detected tools under `WorkflowTracer`, and persists both the tool output and final response back into memory. Treat edits here as architecture-level changes and keep tracer steps consistent so diagnostics remain structured.【F:src/core/AgentOrchestrator.js†L27-L190】【F:src/core/workflows/WorkflowTracer.js†L24-L116】
- `WorkflowTracer` provides lifecycle logging, duration tracking, and preview helpers. Wrap new control-flow branches in `withStep` (or explicit `startStep`/`endStep`) instead of ad-hoc logging so downstream tooling can rely on uniform telemetry.【F:src/core/workflows/WorkflowTracer.js†L24-L116】

## Prompting & tools
- `PromptBuilder` normalises context entries, sorts tools deterministically, and renders the instruction template consumed by the LLM. Any output-format change ripples through snapshot tests and caching, so update call-sites and docs in lockstep.【F:src/core/prompt/PromptBuilder.js†L27-L70】
- `ToolHandler` owns parsing, argument validation, execution, and error shaping for `TOOL_CALL:` directives. Extend `_parseArgs`, `validateRequiredParameters`, or `execute` rather than bypassing them so malformed payloads surface predictably in logs and tests.【F:src/core/tools/ToolHandler.js†L35-L198】
- `toolRegistry` automatically registers the current platform’s tool exports (iOS TurboModules or Android stubs). New tools must expose `{ name, execute, description, parameters }` without side effects at import time so prompt assembly stays accurate.【F:src/core/tools/ToolRegistry.js†L5-L38】【F:src/tools/iosTools.js†L1-L120】

## Memory integration
- `MemoryManager` coordinates vector indexing, sparse-attention retrieval, and bounded conversation history; pass fakes via its constructor when testing alternative stores or embeddings.【F:src/core/memory/MemoryManager.js†L8-L34】
- `VectorIndexer`, `Retriever`, and `HistoryService` provide embedding, sparse re-ranking, and rolling-history primitives. Keep their contracts in sync if you introduce new metadata or retrieval strategies to avoid desynchronised recall.【F:src/core/memory/services/VectorIndexer.js†L1-L25】【F:src/core/memory/services/Retriever.js†L1-L35】【F:src/core/memory/services/HistoryService.js†L1-L16】

## Expectations & tests
- Update or extend the relevant Jest suites whenever you adjust prompt formatting, tool parsing, or memory behaviour. `toolHandler.test.js`, `workflowTracer.test.js`, and `vectorMemory.test.js` currently lock in the observable contracts for these modules.【F:__tests__/toolHandler.test.js†L1-L76】【F:__tests__/workflowTracer.test.js†L1-L40】【F:__tests__/vectorMemory.test.js†L1-L45】
- Document orchestrator changes in `docs/agent-architecture.md` so external readers and downstream automation stay aligned with the runtime semantics.【F:docs/agent-architecture.md†L3-L36】
