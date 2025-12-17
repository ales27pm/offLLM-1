import * as iosTools from "../../tools/iosTools";
import * as androidTools from "../../tools/androidTools";
import { Platform } from "react-native";

const createToolRegistry = () => {
  const tools = new Map();
  const toolCategories = new Map();

  return {
    register(name, tool, category = "general") {
      if (!tool || typeof tool.execute !== "function") {
        throw new Error(`Invalid tool ${name}: missing execute()`);
      }
      tools.set(name, tool);
      if (!toolCategories.has(category)) {
        toolCategories.set(category, new Set());
      }
      toolCategories.get(category).add(name);
    },

    tryRegister(name, tool, category = "general") {
      try {
        this.register(name, tool, category);
        return true;
      } catch (error) {
        console.warn(error.message);
        return false;
      }
    },

    unregister(name) {
      toolCategories.forEach((set) => set.delete(name));
      return tools.delete(name);
    },

    getTool(name) {
      return tools.get(name);
    },

    getAvailableTools(category) {
      const names = category
        ? Array.from(toolCategories.get(category) || [])
        : Array.from(tools.keys());
      return names
        .map((name) => tools.get(name))
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    autoRegister(module) {
      if (!module) return;
      Object.values(module).forEach((tool) => {
        if (tool && tool.name && typeof tool.execute === "function") {
          this.tryRegister(tool.name, tool);
        }
      });
    },
  };
};

export const toolRegistry = createToolRegistry();

const moduleToUse = Platform.OS === "android" ? androidTools : iosTools;
toolRegistry.autoRegister(moduleToUse);
if (process.env.NODE_ENV !== "test") {
  // Lazy load to avoid pulling heavy dependencies in test environments
  const { webSearchTool } = require("../../tools/webSearchTool");
  toolRegistry.register("web_search", webSearchTool, "online");
}

export default toolRegistry;
