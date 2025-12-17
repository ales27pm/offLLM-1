export default class PromptBuilder {
  constructor(toolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  build(userPrompt, context = []) {
    const tools = (this.toolRegistry.getAvailableTools() || [])
      .filter((tool) => tool?.name && tool?.description)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || {},
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const toolsDesc = tools
      .map(
        (t) =>
          `Tool: ${t.name} - ${t.description} (Params: ${JSON.stringify(t.parameters)})`,
      )
      .join("\n");

    const contextLines = (context || [])
      .map((entry) => this._formatContextEntry(entry))
      .filter(Boolean)
      .join("\n");

    return [
      "You are an AI assistant with access to:",
      toolsDesc,
      "Instructions:",
      'Use tools when additional data or actions are required. Emit calls as TOOL_CALL: toolName(param="value"). Reply directly when you already have the answer. Observe tool results to form your final answer.',
      "Context:",
      contextLines,
      `User: ${userPrompt}`,
      "Assistant:",
    ]
      .filter((segment) => segment !== "")
      .join("\n");
  }

  _formatContextEntry(entry) {
    if (entry === null || entry === undefined) return "";
    if (typeof entry === "string") return entry;
    const roleLabel = entry.role
      ? `${entry.role.charAt(0).toUpperCase()}${entry.role.slice(1)}:`
      : "";
    const content =
      typeof entry.content === "string"
        ? entry.content
        : JSON.stringify(entry.content);
    return roleLabel ? `${roleLabel} ${content}` : content;
  }
}
