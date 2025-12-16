import LLMService from "../services/llmService";
import { toolRegistry } from "./tools/ToolRegistry";
import { memoryManager } from "./memory/MemorySingleton";
import PluginSystem from "./plugins/PluginSystem";
import PromptBuilder from "./prompt/PromptBuilder";
import ToolHandler from "./tools/ToolHandler";
import { WorkflowTracer } from "./workflows/WorkflowTracer";

const WORKFLOW_NAME = "AgentOrchestrator";
const MAX_ITERATIONS = 5;
const MAX_CONTEXT_CHARS = 12000;
const TOOL_OUTPUT_LIMIT = 2000; // Increased for better context

const normalizeModelOutput = (result) => {
  if (typeof result === "string") return result;
  if (result && typeof result.text === "string") return result.text;
  return "";
};

const promptLength = (value) =>
  typeof value === "string" ? value.length : normalizeModelOutput(value).length;

export class AgentOrchestrator {
  constructor() {
    this.llm = LLMService;
    this.memory = memoryManager;
    this.promptBuilder = new PromptBuilder(toolRegistry);
    this.toolHandler = new ToolHandler(toolRegistry);
    this.plugins = new PluginSystem();
    this.plugins.loadPlugins();
  }

  _pruneContext(context) {
    const currentLength = context.reduce((acc, msg) => acc + (msg.content?.length || 0), 0);

    // If within limits, return as is
    if (currentLength < MAX_CONTEXT_CHARS) return context;

    console.warn(`[Agent] Pruning context (${currentLength} chars)...`);

    // Always keep System Prompt (usually first message)
    const systemPrompts = context.filter(
      (m) => m.role === "system" && !m.content.startsWith("Observation"),
    );

    // Get the rest of the conversation
    const history = context.filter((m) => !systemPrompts.includes(m));

    // Keep last 6 messages (approx 3 turns)
    const keepCount = 6;
    let trimmedHistory = history.slice(-keepCount);

    // Safety: If the first message in trimmed history is an Observation (system),
    // it likely means we cut off the Tool Call. Remove the orphan observation.
    if (
      trimmedHistory.length > 0 &&
      trimmedHistory[0].role === "system" &&
      trimmedHistory[0].content.startsWith("Observation")
    ) {
      trimmedHistory = trimmedHistory.slice(1);
    }

    return [...systemPrompts, ...trimmedHistory];
  }

  _compressObservation(toolName, output) {
    const text = typeof output === "string" ? output : JSON.stringify(output);
    if (text.length <= TOOL_OUTPUT_LIMIT) return text;
    return `${text.slice(0, TOOL_OUTPUT_LIMIT)}... [Output Truncated]`;
  }

  async run(prompt) {
    const tracer = new WorkflowTracer({ workflowName: WORKFLOW_NAME });
    tracer.info("Workflow started", {
      promptLength: promptLength(prompt),
      promptPreview: tracer.preview(typeof prompt === "string" ? prompt : ""),
    });

    try {
      // 1. Context Retrieval
      const [longMem, shortMem] = await Promise.all([
        this.memory.retrieve(prompt),
        this.memory.getConversationHistory(),
      ]);

      let contextWindow = [...longMem, ...shortMem];
      let currentIteration = 0;
      let finalResponse = null;

      // 2. ReAct Loop
      while (currentIteration < MAX_ITERATIONS) {
        currentIteration++;

        contextWindow = this._pruneContext(contextWindow);

        const currentPrompt = await tracer.withStep(
          `buildPrompt_${currentIteration}`,
          () => Promise.resolve(this.promptBuilder.build(prompt, contextWindow)),
        );

        const rawResponse = await tracer.withStep(
          `modelReasoning_${currentIteration}`,
          () => this.llm.generate(currentPrompt),
        );
        const textResponse = normalizeModelOutput(rawResponse);

        const toolCalls = this.toolHandler.parse(textResponse);

        // No tools? This is the answer.
        if (toolCalls.length === 0) {
          finalResponse = textResponse;
          tracer.info("Final answer reached", { iteration: currentIteration });
          break;
        }

        tracer.info(
          `Iteration ${currentIteration}: Executing ${toolCalls.length} tools`,
        );

        // Execute Tools
        const toolResults = await tracer.withStep(
          `executeTools_${currentIteration}`,
          () => this.toolHandler.execute(toolCalls, { tracer }),
          { successData: (results) => ({ count: results.length }) },
        );

        // Feed results back. Note: We use 'system' role for observations in this prompt format.
        const observations = toolResults.map((res) => ({
          role: "system",
          content: `Observation from tool '${res.name}': ${this._compressObservation(res.name, res.content)}`,
        }));

        contextWindow = [...contextWindow, ...observations];
      }

      if (!finalResponse) {
        finalResponse =
          "I reasoned about the problem but reached the maximum iteration limit without a final answer.";
        tracer.warn("Max iterations reached");
      }

      // 4. Persist Interaction
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

