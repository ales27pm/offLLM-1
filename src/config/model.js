import { getEnv } from "./index";

// Default Dolphin3.0 GGUF model configuration. Url can be overridden via
// MODEL_URL env var and checksum via MODEL_CHECKSUM.
export const MODEL_CONFIG = {
  url:
    getEnv("MODEL_URL") ||
    "https://huggingface.co/TheBloke/Dolphin3.0-Llama3.2-1B-GGUF/resolve/main/dolphin3.0-llama3.2-1b.Q4_K_M.gguf",
  checksum: getEnv("MODEL_CHECKSUM"),
};



