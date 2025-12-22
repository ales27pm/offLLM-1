import { PromptRegistry } from "./PromptRegistry";
import { PromptLoader } from "./PromptLoader";

const stableJson = (value) => {
  const seen = new WeakSet();

  const sortAny = (val) => {
    if (val === null || val === undefined) return val;
    if (typeof val !== "object") return val;
    if (seen.has(val)) return null;
    seen.add(val);

    if (Array.isArray(val)) return val.map(sortAny);
    return Object.keys(val)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortAny(val[key]);
        return acc;
      }, {});
  };

  return JSON.stringify(sortAny(value), null, 2);
};

export default class PromptBuilder {
  constructor({
    toolRegistry,
    promptId = "runtime_system",
    promptVersion = "v1",
  } = {}) {
    if (!toolRegistry) {
      throw new Error("PromptBuilder: toolRegistry required");
    }
    this.toolRegistry = toolRegistry;
    this.promptId = promptId;
    this.promptVersion = promptVersion;
    this.registry = new PromptRegistry();
    this.loader = new PromptLoader(this.registry);
    this.now = () => new Date();
  }

  buildSystemPrompt(allowCapabilities) {
    const toolsJson = this.toolRegistry.toolsJson(
      allowCapabilities ? { allowCapabilities } : {},
    );

    const vars = {
      DATE_ISO: this.now().toISOString(),
      TOOLS_JSON: stableJson(toolsJson),
    };

    const systemPrompt = this.loader.loadAsString(
      this.promptId,
      this.promptVersion,
      vars,
    );

    return {
      systemPrompt,
      promptMeta: {
        prompt_id: this.promptId,
        prompt_version: this.promptVersion,
      },
    };
  }
}
