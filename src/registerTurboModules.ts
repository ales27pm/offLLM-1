// Ensures RN codegen treats these NativeModule specs as "used".
// Safe at runtime: we swallow the error if the native module isn't present.

import { TurboModuleRegistry } from "react-native";
import type { Spec } from "./specs/NativeLLM";

// Mark LLM as used for codegen. Do not export anything.
(() => {
  try {
    // IMPORTANT: codegen looks specifically for `get<Spec>('Name')` calls.
    TurboModuleRegistry.get<Spec>("LLM");
  } catch {
    // No-op at runtime if Turbo module isn't registered yet.
  }
})();



