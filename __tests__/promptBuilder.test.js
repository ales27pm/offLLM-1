import PromptBuilder from "../src/core/prompt/PromptBuilder";

class InMemoryToolRegistry {
  constructor(tools = []) {
    this.tools = tools;
  }

  toolsJson() {
    return [...this.tools].sort((a, b) => a.name.localeCompare(b.name));
  }
}

test("PromptBuilder injects deterministic tool JSON", () => {
  const registry = new InMemoryToolRegistry([
    {
      name: "search",
      description: "web search",
      schema: { type: "object", properties: { query: { type: "string" } } },
      capabilities: ["online"],
    },
    {
      name: "code",
      description: "run code",
      schema: { type: "object", properties: { code: { type: "string" } } },
      capabilities: ["general"],
    },
  ]);

  const builder = new PromptBuilder({ toolRegistry: registry });
  builder.now = () => new Date("2024-01-01T00:00:00.000Z");

  const { systemPrompt } = builder.buildSystemPrompt();

  expect(systemPrompt).toContain("Today is 2024-01-01T00:00:00.000Z");
  const codeIndex = systemPrompt.indexOf('"name": "code"');
  const searchIndex = systemPrompt.indexOf('"name": "search"');
  expect(codeIndex).toBeGreaterThanOrEqual(0);
  expect(searchIndex).toBeGreaterThanOrEqual(0);
  expect(codeIndex).toBeLessThan(searchIndex);
});

test("PromptBuilder filters tools by capability allowlist", () => {
  const registry = new InMemoryToolRegistry([
    {
      name: "search",
      description: "web search",
      schema: { type: "object", properties: { query: { type: "string" } } },
      capabilities: ["online"],
    },
    {
      name: "note",
      description: "take notes",
      schema: { type: "object", properties: { text: { type: "string" } } },
      capabilities: ["general"],
    },
  ]);

  const builder = new PromptBuilder({ toolRegistry: registry });
  const { systemPrompt } = builder.buildSystemPrompt(["general"]);

  expect(systemPrompt).toContain('"name": "note"');
  expect(systemPrompt).not.toContain('"name": "search"');
});
