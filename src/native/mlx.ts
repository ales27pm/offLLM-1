import {
  NativeModules,
  NativeEventEmitter,
  EmitterSubscription,
} from "react-native";
import MLXModule, { GenerateOptions } from "./MLXModule";

const { MLXEvents } = NativeModules;
const emitter = MLXEvents ? new NativeEventEmitter(MLXEvents) : null;

export async function load(modelID?: string): Promise<{ id: string }> {
  return await MLXModule.load(modelID);
}

export function reset() {
  MLXModule.reset();
}
export function unload() {
  MLXModule.unload();
}
export function stop() {
  MLXModule.stop();
}

export async function generate(
  prompt: string,
  options?: GenerateOptions,
): Promise<string> {
  return await MLXModule.generate(prompt, options ?? {});
}

export type StreamHandlers = {
  onToken?: (t: string) => void;
  onCompleted?: () => void;
  onError?: (code: string, message: string) => void;
  onStopped?: () => void;
};

export async function startStream(
  prompt: string,
  handlers: StreamHandlers = {},
  options?: GenerateOptions,
) {
  if (!emitter) {
    handlers.onError?.("NATIVE_MISSING", "Native emitter not available");
    return () => {};
  }

  const subs: EmitterSubscription[] = [];
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    subs.forEach((s) => s.remove());
    subs.length = 0;
  };

  subs.push(
    emitter.addListener("mlxToken", (e: { text: string }) =>
      handlers.onToken?.(e.text),
    ),
  );
  subs.push(
    emitter.addListener("mlxCompleted", () => {
      handlers.onCompleted?.();
      cleanup();
    }),
  );
  subs.push(
    emitter.addListener("mlxError", (e: { code: string; message: string }) => {
      handlers.onError?.(e.code, e.message);
      cleanup();
    }),
  );

  try {
    await MLXModule.startStream(prompt, options ?? {});
  } catch (e: any) {
    handlers.onError?.(e?.code ?? "START_FAIL", e?.message ?? String(e));
    cleanup();
  }

  return cleanup;
}
