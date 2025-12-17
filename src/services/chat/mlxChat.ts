import {
  load as loadModel,
  reset as resetSession,
  unload as unloadSession,
  generate as generateOnce,
} from "../../native/mlx";
import type { GenerateOptions } from "../../native/MLXModule";

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type LoadOptions = {
  /** HuggingFace model id. If omitted, native code tries tiny fallbacks. */
  modelId?: string;
};

export class MlxChat {
  private history: ChatTurn[] = [];
  private loadedModelId: string | null = null;

  async load(opts?: LoadOptions) {
    const { id } = await loadModel(opts?.modelId);
    if (!id) {
      throw new Error("Failed to load MLX model");
    }
    this.loadedModelId = id;
    this.history = [];
    return { id };
  }

  isLoaded() {
    return this.loadedModelId !== null;
  }

  reset() {
    resetSession();
    this.history = [];
  }

  unload() {
    unloadSession();
    this.loadedModelId = null;
    this.history = [];
  }

  /**
   * Sends a user prompt and returns the assistant reply.
   * The native side keeps multi-turn state; we mirror it in JS for UI.
   */
  async send(prompt: string, options?: GenerateOptions) {
    if (!this.isLoaded()) {
      throw new Error("MLX model has not been loaded");
    }
    this.history.push({ role: "user", content: prompt });
    const reply = await generateOnce(prompt, options);
    this.history.push({ role: "assistant", content: reply });
    return reply;
  }

  getHistory() {
    return [...this.history];
  }
}

export const mlxChat = new MlxChat();
