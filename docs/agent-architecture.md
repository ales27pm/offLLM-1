# OffLLM Agent Architecture Guide

## Orchestrator and Control Flow

- `AgentOrchestrator` wires together the language model service, memory, prompt builder, tool handler, and plugin system. The `run` method retrieves long- and short-term context, builds an initial prompt, calls the LLM, parses any `TOOL_CALL` directives, executes the referenced tools, and then issues a final LLM call that incorporates tool output before persisting the exchange to memory.【F:src/core/AgentOrchestrator.js†L1-L174】
- `PromptBuilder` makes the available tool roster explicit by enumerating the registered tools (name, description, parameter schema) and stitching both retrieved context and user input into the prompt template that is handed to the model. Prompt formatting is now anchored to the versioned template in `promptTemplates.json` to keep runtime and training prompts aligned.【F:src/core/prompt/PromptBuilder.js†L1-L35】【F:src/core/prompt/promptTemplate.js†L1-L31】【F:src/core/prompt/promptTemplates.json†L1-L16】
- `ToolHandler` implements the dynamic routing layer: it parses structured tool invocations emitted by the LLM, validates arguments against JSON Schemas before execution, enforces capability allowlists, and returns structured results that are appended to the conversational context.【F:src/core/tools/ToolHandler.js†L1-L216】【F:src/core/tools/toolSchemaValidator.js†L1-L33】【F:schemas/tools/web_search.schema.json†L1-L15】

## Memory and Context Management

- `MemoryManager` couples a vector indexer, retriever, and bounded conversation history so that every interaction is embedded, added to the vector store, and made available for future context retrieval during orchestration.【F:src/core/memory/MemoryManager.js†L1-L37】
- `VectorIndexer`, `Retriever`, and `HistoryService` handle the respective responsibilities of embedding new content, fetching similarity matches (with sparse-attention re-ranking), and tracking the sliding conversational window; chunking now routes through the shared `src/retrieval/chunking.js` utility so runtime and offline pipelines stay aligned.【F:src/core/memory/services/VectorIndexer.js†L1-L33】【F:src/core/memory/services/Retriever.js†L1-L73】【F:src/core/memory/services/HistoryService.js†L1-L17】【F:src/retrieval/chunking.js†L1-L33】
- `ContextEngineer` provides higher-level context planning features such as hierarchical attention, sparse retrieval fallbacks, device-aware token budgeting, and adaptive summarization so the agent can scale prompts across device tiers.【F:src/services/contextEngineer.js†L1-L409】

## LLM Runtime and Plugin System

- `LLMService` encapsulates model loading, web/native bridging, KV-cache management, embeddings, and quantization heuristics while exposing a single `generate` surface to the orchestrator. It instantiates a `PluginManager`, registers built-in plugins, enables them after the model loads, and routes generation calls through the plugin overrides when active.【F:src/services/llmService.js†L1-L353】
- `PluginManager` supports registering plugins with hook, replace, and extend capabilities, orchestrates lifecycle events, applies module/function overrides, and ensures hooks run before/after delegated calls.【F:src/architecture/pluginManager.js†L1-L228】
- `registerLLMPlugins` currently wires the `sparseAttention` and `adaptiveQuantization` plugins, showing how new plugins can override service methods or add initialization logic. The dependency injector seeds device metrics and cache state for plugin access.【F:src/architecture/pluginSetup.js†L1-L31】【F:src/architecture/dependencyInjector.js†L1-L27】【F:src/architecture/diSetup.js†L1-L5】

## Tool Ecosystem

- The runtime `toolRegistry` auto-registers every native tool exported for the current platform (iOS or Android) so the agent can execute native capabilities like calendar events, location, messaging, and more without manual wiring.【F:src/core/tools/ToolRegistry.js†L1-L39】
- For more advanced scenarios, `src/architecture/toolSystem.js` exposes a richer `ToolRegistry` with categories, validation, usage analytics, and a `MCPClient` that can call remote Model Context Protocol servers, plus sample calculator, web search, and filesystem tools to use as templates.【F:src/architecture/toolSystem.js†L1-L392】
- The built-in file-system tool sanitises requested paths and reports UTF-8 byte counts for reads and writes so telemetry reflects the real disk footprint even when strings include multi-byte characters.【F:src/architecture/toolSystem.js†L299-L420】【F:**tests**/toolSystem.test.js†L122-L184】

## Services Exposed as Tools or Skills

- `ReadabilityService` fetches, cleans, and caches article content so agent prompts can include readable text along with metadata like title, byline, and reading time.【F:src/services/readabilityService.js†L1-L159】
- `SearchService` wraps multiple web search providers, adds caching and rate-limiting, and optionally enriches results with cleaned page content via the readability service.【F:src/services/webSearchService.js†L1-L68】
- `TreeOfThoughtReasoner` implements multi-branch reasoning with iterative candidate generation, evaluation, and path selection to supply deliberate answers for complex tasks.【F:src/services/treeOfThought.js†L1-L191】

## Telemetry, Training, and Evaluation

- Telemetry events capture prompts, tool calls, and retrieval signals with redaction and SHA-256 hash metadata, and each event validates against the canonical telemetry JSON Schema before it is persisted for training or evaluation workflows.【F:src/utils/telemetry.js†L1-L236】【F:schemas/telemetry_event.schema.json†L1-L118】
- The LoRA training pipeline now consumes the shared prompt template, ensuring training prompts match the runtime tool-call schema and instruction text.【F:scripts/train_lora.py†L1-L142】【F:src/core/prompt/promptTemplates.json†L1-L16】
- Evaluation scripts provide deterministic checks for prompt regression (prompt output, tool-call diffs, JSON/refusal/citation expectations, and SARIF export), retrieval recall, and export equivalence to keep runtime behavior aligned with tooling outputs and conversion pipelines.【F:scripts/eval/run_prompt_regression.py†L1-L361】【F:scripts/eval/retrieval_eval.py†L1-L54】【F:scripts/eval/export_equivalence.py†L1-L52】

## Workflow and Automation Patterns

- `TreeOfThoughtReasoner.solveComplexProblem` seeds a root node, expands candidate thoughts with configurable branch and depth limits, and returns both the selected solution and the full reasoning tree so workflow engines can replay every step.【F:src/services/treeOfThought.js†L9-L48】
- The same service scores alternatives via `evaluateThought`, prunes low-signal branches, and can run multiple searches in parallel through `parallelTreeSearch`, illustrating how to orchestrate deterministic multi-step plans on top of the core agent loop.【F:src/services/treeOfThought.js†L49-L120】【F:src/services/treeOfThought.js†L166-L189】
- Because the reasoner delegates generation and scoring to `LLMService.generate`, any workflow that relies on deterministic memory access or plugin-aware completions stays aligned with the runtime’s plugin and caching policies.【F:src/services/treeOfThought.js†L1-L76】【F:src/services/llmService.js†L116-L187】

## Trust and Safety Platform

- Long-term memory persists through `VectorMemory`, which enforces encryption-at-rest, schema migrations, and storage limits before writing any payloads to disk, keeping sensitive recall data under quota and uniformly structured.【F:src/memory/VectorMemory.ts†L1-L136】
- Encryption is handled with AES-256-GCM inside `EncryptionService`, guaranteeing authenticated ciphertext for every memory record the persistence layer stores or retrieves.【F:src/services/encryption.ts†L1-L30】
- External-provider calls respect API governance through `getApiKeys`/`validate`, while `simpleCache` deduplicates concurrent fetches without caching failures and `rateLimiter` serialises bursts so trust policies (key presence, request pacing) are enforced even when tools are invoked in tight loops.【F:src/services/utils/apiKeys.js†L1-L23】【F:src/services/utils/cacheAndRate.js†L15-L52】【F:src/services/utils/cacheAndRate.js†L54-L105】

## Bridging and Native Turbo Modules

- `LLMService` prefers the generated TurboModule surface (`NativeLLM`) and falls back to legacy `NativeModules`, enabling the same agent loop to run on web, iOS, or Android without code changes while still routing through plugin management and KV-cache bookkeeping.【F:src/services/llmService.js†L1-L187】
- `registerTurboModules.ts` invokes `TurboModuleRegistry.get` so React Native codegen keeps the LLM interface active, while `MLXModule.ts` enforces the load/generate/startStream/stop surface and `native/mlx.ts` wires the event emitter so streaming tokens raise actionable errors when the Swift/ObjC bridges are absent.【F:src/registerTurboModules.ts†L1-L15】【F:src/native/MLXModule.ts†L1-L28】【F:src/native/mlx.ts†L1-L78】
- On Android, `MonGarsPackage` registers every TurboModule with the bridge, `LlamaTurboModule` exposes the llama.cpp controls to JavaScript, and the JNI layer in `llama_jni.cpp` enforces context/thread limits while providing generation, embedding, and cache maintenance hooks.【F:android/app/src/main/java/com/mongars/MonGarsPackage.java†L11-L45】【F:android/app/src/main/java/com/mongars/LlamaTurboModule.java†L14-L199】【F:android/app/src/main/cpp/llama_jni.cpp†L241-L404】
- iOS mirrors the pattern: `LLM.swift` now drives an MLX-backed runtime that loads model containers, streams tokens through `MLXEvents`, surfaces embeddings, reports CPU/memory metrics, and manages KV-cache boundaries so the TurboModule matches Android’s surface while staying fully on-device.【F:ios/MyOfflineLLMApp/Turbo/LLM.swift†L53-L610】

## Extending the Agent

1. **Add a new tool**: export a module with an `execute` function and register it through `toolRegistry.register`, or plug it into the advanced tool system if you need categorization or remote invocation.【F:src/core/tools/ToolRegistry.js†L5-L31】【F:src/architecture/toolSystem.js†L1-L231】
2. **Introduce a plugin**: implement initialization/cleanup and optional `replace`, `extend`, or `hooks` entries, register it with the shared `PluginManager`, and enable it after model load similar to the built-in sparse attention plugin.【F:src/architecture/pluginManager.js†L10-L227】【F:src/architecture/pluginSetup.js†L1-L31】
3. **Augment memory or context**: compose alternative indexers, retrievers, or context engineers by passing custom implementations into `MemoryManager` or extending `ContextEngineer` to tune retrieval and summarization strategies.【F:src/core/memory/MemoryManager.js†L8-L37】【F:src/services/contextEngineer.js†L171-L409】
4. **Expose new services**: follow the patterns in `ReadabilityService`, `SearchService`, or `TreeOfThoughtReasoner` to encapsulate side-effectful capabilities, then surface them to the agent loop as callable tools or background utilities.【F:src/services/readabilityService.js†L1-L159】【F:src/services/webSearchService.js†L11-L68】【F:src/services/treeOfThought.js†L3-L191】

With these components, OffLLM agents can plan, recall context, safeguard user data, and bridge native capabilities while keeping the orchestration loop compact and extensible.
