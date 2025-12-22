import * as iosTools from "../../tools/iosTools";
import * as androidTools from "../../tools/androidTools";
import { Platform } from "react-native";

const createToolRegistry = () => {
  const tools = new Map();
  const toolCategories = new Map();

  return {
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
      if (!tool || typeof tool.execute !== "function") {
        throw new Error(`Invalid tool ${toolName}: missing execute()`);
      }
      if (!tool.name) tool.name = toolName;
      if (!registryName) {
        throw new Error(`Invalid tool ${toolName}: missing registry name`);
      }
      tools.set(registryName, tool);
      if (!toolCategories.has(category)) {
        toolCategories.set(category, new Set());
      }
      toolCategories.get(category).add(registryName);
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

    getToolCategories(name) {
      const categories = [];
      toolCategories.forEach((set, category) => {
        if (set.has(name)) categories.push(category);
      });
      return categories;
    },

    getAvailableTools(category) {
      const names = category
        ? Array.from(toolCategories.get(category) || [])
        : Array.from(tools.keys());
      return names
        .map((registryName) => {
          const tool = tools.get(registryName);
          if (!tool) return null;
          const toolName = tool.name || registryName;
          return { tool, toolName };
        })
        .filter(Boolean)
        .sort((a, b) => a.toolName.localeCompare(b.toolName))
        .map(({ tool }) => tool);
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
