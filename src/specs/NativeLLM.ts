import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";

export interface GenerateOptions {
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  topP?: number;
  stop?: string[] | null;
  kvBits?: number | null;
  kvGroupSize?: number | null;
  quantizedKVStart?: number | null;
  repetitionPenalty?: number | null;
  repetitionContext?: number | null;
}
export interface LoadOptions {
  quantization?: string | null;
  contextLength?: number | null;
  modelId?: string | null;
}
export interface LoadResult {
  status: string;
  model: string;
  contextLength?: number | null;
  kvCacheMax?: number | null;
}
export interface ToolCallPayload {
  name: string;
  arguments: Record<string, unknown>;
}
export interface GenerateResponse {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  duration?: number;
  kvCacheSize?: number;
  kvCacheMax?: number | null;
  toolCalls?: ToolCallPayload[];
}
export interface PerfMetrics {
  memoryUsage?: number;
  cpuUsage?: number;
  promptTokens?: number;
  completionTokens?: number;
  promptTime?: number;
  generationTime?: number;
  tokensPerSecond?: number;
  promptTokensPerSecond?: number;
}

export interface Spec extends TurboModule {
  loadModel(_path: string, _options?: LoadOptions | null): Promise<LoadResult>;
  unloadModel(): Promise<boolean>;
  generate(
    _prompt: string,
    _options?: GenerateOptions | null,
  ): Promise<GenerateResponse | string>;
  embed(_text: string): Promise<number[]>;
  getPerformanceMetrics(): Promise<PerfMetrics>;
  getKVCacheSize(): Promise<number>;
  getKVCacheMaxSize(): Promise<number>;
  clearKVCache(): Promise<void>;
  addMessageBoundary(): Promise<void>;
  adjustPerformanceMode(_mode: string): Promise<boolean>;
}

// Probe for codegen so the spec is marked as used.
try {
  // IMPORTANT: codegen looks specifically for `get<Spec>('Name')` calls.
  TurboModuleRegistry.get<Spec>("LLM");
} catch {
  // Ignore missing native module during runtime.
}

// Expose the TurboModule; returns `null` when the native implementation is missing.
export default TurboModuleRegistry.getOptional<Spec>("LLM");



