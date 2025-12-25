import LLMService from "../services/llmService";
import { toolRegistry } from "./tools/ToolRegistry";
import { memoryManager } from "./memory/MemorySingleton";
import PluginSystem from "./plugins/PluginSystem";
import PromptBuilder from "./prompt/PromptBuilder";
import ToolHandler from "./tools/ToolHandler";
import { WorkflowTracer } from "./workflows/WorkflowTracer";
import { TelemetrySink } from "../utils/telemetry";

const WORKFLOW_NAME = "AgentOrchestrator";
const MAX_ITERATIONS = 4;
const MAX_CONTEXT_CHARS = 12000;
const TOOL_OUTPUT_LIMIT = 2000;

const normalizeModelOutput = (result) => {
  if (typeof result === "string") return result;
  if (result && typeof result.text === "string") return result.text;
  return "";
};

const promptLength = (value) =>
  typeof value === "string" ? value.length : normalizeModelOutput(value).length;

const asMsg = (role, content) => ({ role, content: String(content || "") });

export class AgentOrchestrator {
  constructor(opts = {}) {
    this.llm = opts.llmClient || LLMService;
    this.memory = opts.memory || memoryManager;
    this.toolRegistry = opts.toolRegistry || toolRegistry;

    this.allowCapabilities = Array.isArray(opts.allowCapabilities)
      ? opts.allowCapabilities
      : null;

    this.promptBuilder = new PromptBuilder({
      toolRegistry: this.toolRegistry,
      promptId: opts.promptId || "runtime_system",
      promptVersion: opts.promptVersion || "v1",
    });

    this.toolHandler = new ToolHandler(this.toolRegistry, {
      allowCapabilities: this.allowCapabilities,
    });

    this.telemetry =
      opts.telemetry ||
      new TelemetrySink({
        appName: opts.appName || "offLLM",
        appVersion: opts.appVersion || "0.0.0",
        modelId: opts.modelId || this._getModelId(),
        modelRuntime: opts.modelRuntime || "local",
        modelQuant: opts.modelQuant || "",
        outDir: opts.telemetryOutDir || null,
      });

    this.sessionId =
      opts.sessionId ||
      `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    this.plugins = new PluginSystem();
    this.plugins.loadPlugins();
  }

  _getModelId() {
    return typeof this.llm.getModelId === "function"
      ? this.llm.getModelId()
      : "unknown";
  }

  _pruneContext(context) {
    const currentLength = context.reduce(
      (acc, msg) => acc + (msg.content?.length || 0),
      0,
    );

    if (currentLength < MAX_CONTEXT_CHARS) return context;

    console.warn(`[Agent] Pruning context (${currentLength} chars)...`);

    const systemPrompts = context.filter(
      (m) => m.role === "system" && !m.content.startsWith("Observation"),
    );

    const history = context.filter((m) => !systemPrompts.includes(m));
    const keepCount = 6;
    let trimmedHistory = history.slice(-keepCount);

    if (
      trimmedHistory.length > 0 &&
      trimmedHistory[0].role === "system" &&
      trimmedHistory[0].content.startsWith("Observation")
    ) {
      trimmedHistory = trimmedHistory.slice(1);
    }

    return [...systemPrompts, ...trimmedHistory];
  }

  _compressObservation(output) {
    const text = typeof output === "string" ? output : JSON.stringify(output);
    if (text.length <= TOOL_OUTPUT_LIMIT) return text;
    return `${text.slice(0, TOOL_OUTPUT_LIMIT)}... [Output Truncated]`;
  }

  async _chat(messages, options = {}) {
    if (typeof this.llm.chat === "function") {
      return this.llm.chat(messages, options);
    }
    const prompt = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");
    const response = await this.llm.generate(
      prompt,
      options.max_tokens || 800,
      options.temperature || 0,
    );
    return normalizeModelOutput(response);
  }

  async run(prompt, opts = {}) {
    const tracer = new WorkflowTracer({ workflowName: WORKFLOW_NAME });
    tracer.info("Workflow started", {
      promptLength: promptLength(prompt),
      promptPreview: tracer.preview(typeof prompt === "string" ? prompt : ""),
    });

    const turnId =
      opts.turnId ||
      `turn_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    try {
      const [longMem, shortMem] = await Promise.all([
        this.memory.retrieve(prompt),
        this.memory.getConversationHistory(),
      ]);

      let contextWindow = [...longMem, ...shortMem];
      let currentIteration = 0;
      let finalResponse = null;

      const { systemPrompt, promptMeta } = this.promptBuilder.buildSystemPrompt(
        this.allowCapabilities,
      );
      const systemHash = this.telemetry.systemHash(systemPrompt);

      while (currentIteration < MAX_ITERATIONS) {
        currentIteration += 1;

        contextWindow = this._pruneContext(contextWindow);

        const convo = [
          asMsg("system", systemPrompt),
          ...contextWindow.map((entry) =>
            asMsg(entry.role || "system", entry.content || entry),
          ),
          asMsg("user", prompt),
        ];

        this.telemetry.event(
          "model_interaction",
          {
            phase: "request",
            messages_count: convo.length,
            user_chars: String(prompt || "").length,
          },
          {
            prompt: { ...promptMeta, system_hash: systemHash },
            conversation: { turn_id: turnId, session_id: this.sessionId },
          },
        );

        const rawResponse = await tracer.withStep(
          `modelReasoning_${currentIteration}`,
          () => this._chat(convo, { temperature: 0, max_tokens: 800 }),
        );
        const assistant = normalizeModelOutput(rawResponse);

        this.telemetry.event(
          "model_interaction",
          {
            phase: "response",
            assistant_chars: String(assistant || "").length,
          },
          {
            prompt: { ...promptMeta, system_hash: systemHash },
            conversation: { turn_id: turnId, session_id: this.sessionId },
          },
        );

        const calls = this.toolHandler.parseCalls(assistant);
        const goodCalls = calls.filter((call) => call.ok);

        if (!goodCalls.length) {
          finalResponse = assistant;
          tracer.info("Final answer reached", { iteration: currentIteration });
          break;
        }

        tracer.info(
          `Iteration ${currentIteration}: Executing ${goodCalls.length} tools`,
        );

        for (const call of goodCalls) {
          this.telemetry.event(
            "tool_call",
            { tool: call.tool, args: call.args },
            {
              prompt: { ...promptMeta, system_hash: systemHash },
              conversation: { turn_id: turnId, session_id: this.sessionId },
            },
          );

          const res = await this.toolHandler.executeCall(call, {
            allowCapabilities: this.allowCapabilities,
          });

          this.telemetry.event(
            "tool_result",
            {
              tool: call.tool,
              ok: res.ok,
              error: res.ok ? null : res.error,
              details: res.ok ? null : res.details,
            },
            {
              prompt: { ...promptMeta, system_hash: systemHash },
              conversation: { turn_id: turnId, session_id: this.sessionId },
            },
          );

          const observation = res.ok
            ? JSON.stringify(res.result)
            : JSON.stringify({ error: res.error, details: res.details });

          contextWindow = [
            ...contextWindow,
            asMsg(
              "system",
              `Observation: ${this._compressObservation(observation)}`,
            ),
          ];
        }

        const followup = await this._chat(
          [
            asMsg("system", systemPrompt),
            ...contextWindow.map((entry) =>
              asMsg(entry.role || "system", entry.content || entry),
            ),
          ],
          { temperature: 0, max_tokens: 800 },
        );
        finalResponse = normalizeModelOutput(followup);

        this.telemetry.event(
          "model_interaction",
          {
            phase: "post_tools_response",
            assistant_chars: String(finalResponse || "").length,
            iter: currentIteration,
          },
          {
            prompt: { ...promptMeta, system_hash: systemHash },
            conversation: { turn_id: turnId, session_id: this.sessionId },
          },
        );
      }

      if (!finalResponse) {
        finalResponse =
          "I reasoned about the problem but reached the maximum iteration limit without a final answer.";
        tracer.warn("Max iterations reached");
      }

      await tracer.withStep(
        "persistMemory",
        () => this.memory.addInteraction(prompt, finalResponse, contextWindow),
        { successData: () => ({ status: "saved" }) },
      );

      tracer.finish({
        iterations: currentIteration,
        finalResponseLength: finalResponse.length,
      });
      return finalResponse;
    } catch (error) {
      tracer.fail(error, { promptLength: promptLength(prompt) });
      throw error;
    }
  }
}

export default AgentOrchestrator;
