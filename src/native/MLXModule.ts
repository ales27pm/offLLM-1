import { NativeModules, Platform } from "react-native";

export type GenerateOptions = {
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  repetitionPenalty?: number;
};

type MLXNative = {
  load(modelId?: string): Promise<{ id: string; status: string }>;
  generate(prompt: string, options?: GenerateOptions): Promise<string>;
  startStream(prompt: string, options?: GenerateOptions): Promise<void>;
  reset(): void;
  unload(): void;
  stop(): void;
  getPerformanceMetrics?(): Promise<any>;
  getKVCacheSize?(): Promise<number>;
  clearKVCache?(): Promise<void>;
};

const Native: Partial<MLXNative> = NativeModules.MLXModule ?? {};

if (Platform.OS === "ios" && (!Native.load || !Native.generate)) {
  throw new Error("MLXModule native module not linked.");
}

export const MLXModule = Native as MLXNative;
export default MLXModule;

