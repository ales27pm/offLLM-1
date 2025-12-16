export default class PromptBuilder {
  constructor(toolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  build(userPrompt, context = []) {
    const tools = this.toolRegistry.getAvailableTools();

    const toolsDesc = tools
      .map(
        (t) =>
          `- ${t.name}: ${t.description} (Params: ${JSON.stringify(t.parameters)})`,
      )
      .join("\n");

    const systemPrompt = `You are a helpful AI assistant capable of using tools.
When you need information or need to perform an action, output a tool call in the format: 
TOOL_CALL: toolName(param="value")

Available Tools:
${toolsDesc}

Instructions:
1. Use tools when you lack information.
2. If you have the answer, just reply normally.
3. Observe tool results to form your final answer.
`;

    const historyStr = context
      .map((entry) => {
        const role =
          entry.role === "user"
            ? "User"
            : entry.role === "system"
              ? "System"
              : "Assistant";
        return `${role}: ${entry.content}`;
      })
      .join("\n\n");

    return `${systemPrompt}\n\nPrevious Interactions:\n${historyStr}\n\nUser: ${userPrompt}\nAssistant:`;
  }
}

