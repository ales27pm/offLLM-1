# Tools Guide

## Export contract
- Export each tool as an object exposing `{ name, description, parameters, execute }`. The runtime registry auto-loads every export with an `execute` function, so keep module scope free of side effects and ensure metadata matches the runtime prompt expectations.【F:src/core/tools/ToolRegistry.js†L5-L38】
- Parameter schemas feed both prompt rendering and runtime validation. Populate `type`, `required`, `default`, `enum`, and any custom `validate` callbacks so `PromptBuilder` and `ToolHandler` stay in sync.【F:src/core/prompt/PromptBuilder.js†L27-L70】【F:src/core/tools/ToolHandler.js†L35-L198】

## Platform modules
- iOS tools call into TurboModules for calendar, messaging, location, sensors, clipboard, and more. Guard optional arguments, surface useful errors, and return JSON-serialisable payloads—`ToolHandler` persists the result strings back into conversation memory.【F:src/tools/iosTools.js†L1-L200】【F:src/core/AgentOrchestrator.js†L100-L183】
- Android currently exposes explicit “unsupported” stubs that throw descriptive errors. Keep stub names aligned with their iOS counterparts so prompts advertise consistent capabilities across platforms.【F:src/tools/androidTools.js†L1-L15】

## Service-backed tools
- When wrapping services (e.g., web search), reuse shared helpers rather than duplicating logic. `webSearchTool` delegates to `SearchService.performSearchWithContentExtraction`, which already handles provider selection, rate limiting, caching, and readability enrichment.【F:src/tools/webSearchTool.js†L4-L85】【F:src/services/webSearchService.js†L1-L65】
- Prefer returning structured `{ success, ... }` objects over throwing. If a tool must throw (e.g., unsupported platform), ensure the error message is actionable; the orchestrator records the string in the conversation log.【F:src/core/tools/ToolHandler.js†L141-L198】

## Tests
- Extend `toolHandler.test.js` whenever you add new tool commands or parser capabilities so malformed arguments and error handling remain covered by CI.【F:__tests__/toolHandler.test.js†L1-L76】
