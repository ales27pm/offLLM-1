import { memoryManager } from "../core/memory/MemorySingleton";
import { getEnv } from "../config";

export function useMemory() {
  const recall = async (q: string) => {
    if (getEnv("MEMORY_ENABLED") !== "true") return "";
    try {
      const results = await memoryManager.retrieve(q, 3);
      return results.map((r) => r.content).join("\n\n");
    } catch (e) {
      console.error("Memory recall failed", e);
      return "";
    }
  };

  const rememberPair = async (text: string, role: "user" | "assistant") => {
    if (getEnv("MEMORY_ENABLED") !== "true") return;
    try {
      await memoryManager.history.add({ role, content: text });
    } catch (e) {
      console.error("Memory remember failed", e);
    }
  };

  return { recall, rememberPair };
}
