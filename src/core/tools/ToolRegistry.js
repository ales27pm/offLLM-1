import * as iosTools from "../../tools/iosTools";
import * as androidTools from "../../tools/androidTools";
import { Platform } from "react-native";

const parametersToSchema = (parameters = {}) => {
  const properties = {};
  const required = [];
  for (const [key, meta] of Object.entries(parameters)) {
    properties[key] = { type: meta?.type };
    if (meta?.enum) properties[key].enum = meta.enum;
    if (meta?.description) properties[key].description = meta.description;
    if (meta?.required) required.push(key);
  }
  return {
    type: "object",
    properties,
    required: required.length ? required : undefined,
    additionalProperties: true,
  };
};

class ToolRegistry {
  constructor() {
    this._tools = new Map();
    this._toolCategories = new Map();
  }

  register(name, tool, category = "general") {
    const toolName =
      tool && typeof tool.name === "string" && tool.name.trim()
        ? tool.name
        : name;
    const registryName =
      typeof name === "string" && name.trim() ? name : toolName;
    if (!toolName || typeof toolName !== "string") {
      throw new Error(`Invalid tool ${name}: missing valid name`);
    }
    if (
      !tool ||
      (typeof tool.execute !== "function" && typeof tool.handler !== "function")
    ) {
      throw new Error(`Invalid tool ${toolName}: missing execute()`);
    }

    const handler = tool.handler || tool.execute;
    const schema = tool.schema || parametersToSchema(tool.parameters || {});
    const capabilities = Array.isArray(tool.capabilities)
      ? tool.capabilities.slice().sort()
      : category
        ? [category]
        : [];

    const normalized = {
      ...tool,
      name: toolName,
      description: String(tool.description || ""),
      schema,
      capabilities,
      handler,
      execute: handler,
    };

    this._tools.set(registryName, normalized);
    if (!this._toolCategories.has(category)) {
      this._toolCategories.set(category, new Set());
    }
    this._toolCategories.get(category).add(registryName);
  }

  tryRegister(name, tool, category = "general") {
    try {
      this.register(name, tool, category);
      return true;
    } catch (error) {
      console.warn(error.message);
      return false;
    }
  }

  unregister(name) {
    this._toolCategories.forEach((set) => set.delete(name));
    return this._tools.delete(name);
  }

  get(name) {
    return this._tools.get(name);
  }

  getTool(name) {
    return this._tools.get(name);
  }

  getToolCategories(name) {
    const categories = [];
    this._toolCategories.forEach((set, category) => {
      if (set.has(name)) categories.push(category);
    });
    return categories;
  }

  getAvailableTools(category) {
    const names = category
      ? Array.from(this._toolCategories.get(category) || [])
      : Array.from(this._tools.keys());
    return names
      .map((registryName) => {
        const tool = this._tools.get(registryName);
        if (!tool) return null;
        const toolName = tool.name || registryName;
        return { tool, toolName };
      })
      .filter(Boolean)
      .sort((a, b) => a.toolName.localeCompare(b.toolName))
      .map(({ tool }) => tool);
  }

  autoRegister(module) {
    if (!module) return;
    Object.values(module).forEach((tool) => {
      if (tool && tool.name && typeof tool.execute === "function") {
        this.tryRegister(tool.name, tool);
      }
    });
  }

  list(opts = {}) {
    const allowCaps = opts.allowCapabilities
      ? new Set(opts.allowCapabilities)
      : null;
    const out = [];
    for (const tool of this._tools.values()) {
      if (allowCaps && tool.capabilities.length) {
        const ok = tool.capabilities.some((cap) => allowCaps.has(cap));
        if (!ok) continue;
      }
      out.push(tool);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  toolsJson(opts = {}) {
    return this.list(opts).map((tool) => ({
      name: tool.name,
      description: tool.description,
      schema: tool.schema,
      capabilities: tool.capabilities,
    }));
  }
}

export const toolRegistry = new ToolRegistry();

const moduleToUse = Platform.OS === "android" ? androidTools : iosTools;
toolRegistry.autoRegister(moduleToUse);
if (process.env.NODE_ENV !== "test") {
  const { webSearchTool } = require("../../tools/webSearchTool");
  toolRegistry.register("web_search", webSearchTool, "online");
}

export default toolRegistry;
