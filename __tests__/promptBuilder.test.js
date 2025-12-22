import fs from "fs";
import path from "path";
import PromptBuilder from "../src/core/prompt/PromptBuilder";
import ToolHandler from "../src/core/tools/ToolHandler";

class InMemoryToolRegistry {
  constructor(tools = []) {
    this.tools = new Map();
    tools.forEach((tool) => {
      this.register(tool);
    });
  }

  register(tool) {
    this.tools.set(tool.name, tool);
  }

  getAvailableTools() {
    return Array.from(this.tools.values());
  }

  getTool(name) {
    return this.tools.get(name);
  }
}

const createTool = ({ name, description, parameters, execute }) => ({
  name,
  description,
  parameters,
  execute,
});

describe("PromptBuilder", () => {
  it("lists available tools alphabetically and preserves context order", () => {
    const searchTool = createTool({
      name: "search",
      description: "web search",
      parameters: {
        query: { type: "string", required: true },
      },
      execute: async ({ query }) => ({ results: [`result for ${query}`] }),
    });

    const codeTool = createTool({
      name: "code",
      description: "run code",
      parameters: {
        language: { type: "string", required: true },
        code: { type: "string", required: true },
      },
      execute: async ({ language, code }) => ({ language, code }),
    });

    const registry = new InMemoryToolRegistry([searchTool, codeTool]);
    const builder = new PromptBuilder(registry);
    const context = [
      "string context entry",
      { content: "previous conversation" },
      { content: "system note" },
    ];
    const prompt = builder.build("Write a summary", context);

    expect(prompt).toContain("You are an AI assistant with access to:");
    expect(prompt).toContain("Context:");
    expect(prompt).toContain("User: Write a summary");
    expect(prompt.trim().endsWith("Assistant:")).toBe(true);

    const searchIndex = prompt.indexOf(`Tool: ${searchTool.name}`);
    const codeIndex = prompt.indexOf(`Tool: ${codeTool.name}`);
    expect(searchIndex).toBeGreaterThanOrEqual(0);
    expect(codeIndex).toBeGreaterThanOrEqual(0);
    expect(codeIndex).toBeLessThan(searchIndex);
    expect(prompt).toContain(
      `(Params: ${JSON.stringify(searchTool.parameters)})`,
    );
    expect(prompt).toContain(
      `Tool: ${codeTool.name} - ${codeTool.description}`,
    );
    expect(prompt).toContain(
      `(Params: ${JSON.stringify(codeTool.parameters)})`,
    );

    const firstContextIndex = prompt.indexOf(context[0]);
    const secondContextIndex = prompt.indexOf(context[1].content);
    const thirdContextIndex = prompt.indexOf(context[2].content);
    expect(firstContextIndex).toBeGreaterThanOrEqual(0);
    expect(secondContextIndex).toBeGreaterThan(firstContextIndex);
    expect(thirdContextIndex).toBeGreaterThan(secondContextIndex);
  });

  it("handles empty tool and context lists", () => {
    const registry = new InMemoryToolRegistry();
    const builder = new PromptBuilder(registry);

    const prompt = builder.build("Hello there");

    expect(prompt).toContain("You are an AI assistant with access to:");
    expect(prompt).not.toContain("Tool:");
    expect(prompt).toContain("Context:");
    expect(prompt).toContain("User: Hello there");
  });

  it("reflects runtime tool registry updates without caching results", () => {
    const registry = new InMemoryToolRegistry();
    const builder = new PromptBuilder(registry);

    const planTool = createTool({
      name: "planner",
      description: "plan tasks",
      parameters: {
        topic: { type: "string", required: true },
      },
      execute: async ({ topic }) => ({ plan: `Plan for ${topic}` }),
    });

    registry.register(planTool);
    const firstPrompt = builder.build("Organize the day");

    expect(firstPrompt).toContain(
      `Tool: ${planTool.name} - ${planTool.description}`,
    );
    expect(firstPrompt).not.toContain("summarize notes");

    const summaryTool = createTool({
      name: "summarizer",
      description: "summarize notes",
      parameters: {
        notes: { type: "string", required: true },
      },
      execute: async ({ notes }) => ({ summary: notes.slice(0, 10) }),
    });

    registry.register(summaryTool);
    const secondPrompt = builder.build("Organize the day");

    expect(secondPrompt).toContain(
      `Tool: ${summaryTool.name} - ${summaryTool.description}`,
    );
    expect(secondPrompt).toContain("summarize notes");
    expect(firstPrompt).not.toContain(
      `Tool: ${summaryTool.name} - ${summaryTool.description}`,
    );
  });

  it("incorporates conversation history and executed tool output", async () => {
    const registry = new InMemoryToolRegistry();
    const builder = new PromptBuilder(registry);

    const doublerTool = createTool({
      name: "doubler",
      description: "double numeric strings",
      parameters: {
        value: { type: "number", required: true },
      },
      execute: async ({ value }) => {
        const numeric = Number(value);
        return { doubled: numeric * 2 };
      },
    });

    registry.register(doublerTool);

    const toolHandler = new ToolHandler(registry, {
      schemaValidator: () => ({ valid: true, errors: [] }),
    });
    const llmResponse = 'TOOL_CALL:doubler(value="21")';
    const calls = toolHandler.parse(llmResponse);
    const toolResults = await toolHandler.execute(calls);

    const conversation = [
      { role: "user", content: "How do I double 21?" },
      { role: "assistant", content: "Let me calculate that." },
    ];
    const prompt = builder.build("Share the doubled result", [
      ...conversation,
      ...toolResults,
    ]);

    expect(prompt).toContain("How do I double 21?");
    expect(prompt).toContain("Let me calculate that.");
    expect(prompt).toContain('{"doubled":42}');
    expect(prompt).toContain("User: Share the doubled result");
  });

  it("omits tools missing required metadata", () => {
    const validTool = createTool({
      name: "executor",
      description: "valid tool",
      parameters: {},
      execute: async () => ({ ok: true }),
    });

    const registry = new InMemoryToolRegistry([
      { description: "missing name", execute: async () => ({}) },
      { name: "", description: "empty name", execute: async () => ({}) },
      { name: "anon", execute: async () => ({}) },
      validTool,
    ]);

    const builder = new PromptBuilder(registry);
    const prompt = builder.build("Check tool list");

    expect(prompt).toContain(
      `Tool: ${validTool.name} - ${validTool.description}`,
    );
    expect(prompt).not.toContain("missing name");
    expect(prompt).not.toContain("empty name");
    expect(prompt).not.toContain("anon");
    expect(prompt).toContain("(Params: {})");
  });

  it("surfaces missing required tool parameters as execution errors", async () => {
    const registry = new InMemoryToolRegistry();
    const builder = new PromptBuilder(registry);

    const validatorTool = createTool({
      name: "validator",
      description: "requires foo",
      parameters: {
        foo: { type: "string", required: true },
      },
      execute: async ({ foo }) => ({ foo }),
    });

    registry.register(validatorTool);
    const toolHandler = new ToolHandler(registry, {
      schemaValidator: () => ({
        valid: false,
        errors: ["(root) must have required property 'foo'"],
      }),
    });

    const calls = toolHandler.parse("TOOL_CALL:validator()");
    const toolResults = await toolHandler.execute(calls);

    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].content).toContain(
      "Invalid parameters for 'validator': (root) must have required property 'foo'",
    );

    const prompt = builder.build("Proceed", toolResults);
    expect(prompt).toContain(
      "Invalid parameters for 'validator': (root) must have required property 'foo'",
    );
    expect(prompt).toContain(
      `Tool: ${validatorTool.name} - ${validatorTool.description}`,
    );
  });

  const goldenPath = path.join(
    __dirname,
    "..",
    "scripts",
    "eval",
    "golden_prompts.json",
  );
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf-8"));
  const goldenCases = golden.map((entry) => [entry.id, entry]);

  it.each(goldenCases)("matches golden prompt %s", (_id, entry) => {
    const registry = {
      getAvailableTools: () => entry.tools,
    };
    const builder = new PromptBuilder(registry);
    const prompt = builder.build(entry.user_prompt, entry.context);
    expect(prompt).toBe(entry.expected_prompt);
  });
});
