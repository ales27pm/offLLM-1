# Test Suites Guide

## Scope & layout
- Jest coverage here protects the runtime, services, tools, memory, and logging layers. Keep suites in sync with the contracts they exercise (`llmService`, `toolHandler`, `vectorMemory`, `workflowTracer`, `logger`, etc.).【F:__tests__/llmService.test.js†L1-L33】【F:__tests__/toolHandler.test.js†L1-L76】【F:__tests__/vectorMemory.test.js†L1-L45】【F:__tests__/workflowTracer.test.js†L1-L40】【F:__tests__/logger.test.ts†L1-L34】
- Prefer lightweight fixtures and inline mocks so `npm test` stays fast and deterministic; existing suites rely on local helpers rather than large snapshots.【F:__tests__/toolHandler.test.js†L1-L52】【F:__tests__/vectorMemory.test.js†L1-L33】

## Authoring guidance
- Treat every bug fix as a test-first change. Reproduce malformed tool calls, orchestration regressions, or persistence issues in these suites before landing the patch so CI can guard against regressions automatically.【F:__tests__/toolHandler.test.js†L27-L69】【F:__tests__/vectorMemory.test.js†L1-L33】
- Exercise public entry points (`ToolHandler.parse`, `WorkflowTracer.withStep`, `VectorMemory.recall`, `LLMService.generate`) and assert on observable side effects rather than private helpers to keep tests resilient to refactors.【F:__tests__/toolHandler.test.js†L5-L69】【F:__tests__/workflowTracer.test.js†L1-L32】【F:__tests__/vectorMemory.test.js†L1-L40】【F:__tests__/llmService.test.js†L15-L33】
- Place new suites under `__tests__/` using Jest’s default `*.test.(js|ts)` glob—no extra configuration is required beyond exporting the test file.【F:package.json†L6-L14】

## Execution & maintenance
- Run `npm test` (and `npm run test:ci` for coverage) before committing. The repository’s lint and format checks must also pass so tests stay readable and type-safe.【F:package.json†L6-L14】
- When tests depend on diagnostics or filesystem state, stub the inputs (logs, report files, storage) instead of relying on committed artefacts. `logger.test.ts` shows how to mock persistent storage safely.【F:__tests__/logger.test.ts†L19-L45】

## Living history
- 2025-09 — Parser coverage in `toolHandler.test.js` expanded to catch malformed argument strings and required-parameter errors; extend those cases when evolving the prompt grammar.【F:__tests__/toolHandler.test.js†L1-L69】
- 2025-09 — The vector memory suite verifies encryption-at-rest, migration bumps, and quota enforcement, preventing plaintext leaks when storage policies change.【F:__tests__/vectorMemory.test.js†L1-L40】
