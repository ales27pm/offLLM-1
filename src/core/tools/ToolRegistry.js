import * as iosTools from "../../tools/iosTools";
import * as androidTools from "../../tools/androidTools";
import { Platform } from "react-native";
import { webSearchTool } from "../../tools/webSearchTool";

const createToolRegistry = () => {
  const tools = new Map();
  const toolCategories = new Map();

  return {
    register(name, tool, category = "general") {
      if (!tool || typeof tool.execute !== "function") {
        console.warn(`Invalid tool registration attempt: ${name}`);
        return;
      }
      tools.set(name, tool);
      if (!toolCategories.has(category)) {
        toolCategories.set(category, new Set());
      }
      toolCategories.get(category).add(name);
    },

    getTool(name) {
      return tools.get(name);
    },

    getAvailableTools() {
      return Array.from(tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    },

    autoRegister(module) {
      if (!module) return;
      Object.values(module).forEach((tool) => {
        if (tool && tool.name && typeof tool.execute === "function") {
          this.register(tool.name, tool);
        }
      });
    },
  };
};

export const toolRegistry = createToolRegistry();

const moduleToUse = Platform.OS === "android" ? androidTools : iosTools;
toolRegistry.autoRegister(moduleToUse);
toolRegistry.register("web_search", webSearchTool, "online");

export default toolRegistry;

