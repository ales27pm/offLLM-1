import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import SHA256 from "crypto-js/sha256";

const nowMs = () => Date.now();

const uuidLike = () =>
  `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;

const sha256 = (value) => SHA256(String(value)).toString();

const REDACT_PATTERNS = [
  { re: /\b(sk-[A-Za-z0-9]{16,})\b/g, repl: "[REDACTED_TOKEN]" },
  { re: /\b(ghp_[A-Za-z0-9]{20,})\b/g, repl: "[REDACTED_TOKEN]" },
  { re: /\b(glpat-[A-Za-z0-9\-_]{10,})\b/g, repl: "[REDACTED_TOKEN]" },
  { re: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g, repl: "[REDACTED_TOKEN]" },
  {
    re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    repl: "[REDACTED_EMAIL]",
  },
];

const redactString = (value) => {
  let out = String(value);
  for (const p of REDACT_PATTERNS) out = out.replace(p.re, p.repl);
  return out;
};

const deepRedact = (value) => {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(deepRedact);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => {
        if (/token|secret|password|key/i.test(key)) {
          return [key, "[REDACTED_SECRET_FIELD]"];
        }
        return [key, deepRedact(val)];
      }),
    );
  }
  return value;
};

const validateEventMinimal = (evt) => {
  if (!evt || typeof evt !== "object") return false;
  if (!evt.event_id || typeof evt.event_id !== "string") return false;
  if (typeof evt.ts_ms !== "number") return false;
  if (!evt.type || typeof evt.type !== "string") return false;
  if (!evt.app || typeof evt.app !== "object") return false;
  if (!evt.model || typeof evt.model !== "object") return false;
  if (!evt.app.name || !evt.app.version) return false;
  if (!evt.model.id) return false;
  return true;
};

const getTelemetryDirectory = () => {
  if (Platform.OS === "web" || !FileSystem.documentDirectory) {
    return null;
  }
  return `${FileSystem.documentDirectory}telemetry/`;
};

const ensureDirectory = async (directory) => {
  try {
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    return directory;
  } catch {
    return null;
  }
};

class TelemetrySink {
  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    this.appName = opts.appName || "offLLM";
    this.appVersion = opts.appVersion || "0.0.0";
    this.platform = opts.platform || Platform.OS;
    this.modelId = opts.modelId || "unknown-model";
    this.modelRuntime = opts.modelRuntime || "unknown-runtime";
    this.modelQuant = opts.modelQuant || "";
    this.outDir = opts.outDir || null;
    this.buffer = [];
    this.maxBuffer = opts.maxBuffer || 5000;
  }

  event(type, payload, ctx = {}) {
    if (!this.enabled) return null;

    const evt = {
      event_id: uuidLike(),
      ts_ms: nowMs(),
      type,
      app: {
        name: this.appName,
        version: this.appVersion,
        platform: this.platform,
      },
      model: {
        id: this.modelId,
        runtime: this.modelRuntime,
        quant: this.modelQuant,
      },
      prompt: ctx.prompt
        ? {
            prompt_id: ctx.prompt.prompt_id,
            prompt_version: ctx.prompt.prompt_version,
            system_hash: ctx.prompt.system_hash,
          }
        : undefined,
      conversation: ctx.conversation
        ? {
            turn_id: ctx.conversation.turn_id,
            session_id: ctx.conversation.session_id,
          }
        : undefined,
      payload: deepRedact(payload || {}),
    };

    if (evt.prompt == null) delete evt.prompt;
    if (evt.conversation == null) delete evt.conversation;

    if (!validateEventMinimal(evt)) {
      const fail = {
        event_id: uuidLike(),
        ts_ms: nowMs(),
        type: "error",
        app: evt.app,
        model: evt.model,
        payload: { reason: "invalid_event_shape", original_type: type },
      };
      this._push(fail);
      return fail.event_id;
    }

    this._push(evt);
    return evt.event_id;
  }

  _push(evt) {
    this.buffer.push(evt);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.splice(0, this.buffer.length - this.maxBuffer);
    }
    if (this.outDir) {
      void this.flushToDisk();
    }
  }

  async flushToDisk() {
    if (!this.outDir) return;
    const baseDir =
      this.outDir === "default" ? getTelemetryDirectory() : this.outDir;
    if (!baseDir) return;
    const directory = await ensureDirectory(baseDir);
    if (!directory) return;
    const filePath = `${directory}telemetry-${new Date().toISOString().slice(0, 10)}.jsonl`;
    const lines = this.buffer.map((e) => JSON.stringify(e)).join("\n") + "\n";
    this.buffer = [];
    await FileSystem.writeAsStringAsync(filePath, lines, {
      encoding: FileSystem.EncodingType.UTF8,
      append: true,
    });
  }

  snapshot() {
    return [...this.buffer];
  }

  systemHash(systemPrompt) {
    return sha256(systemPrompt);
  }
}

export { TelemetrySink, redactString, deepRedact, sha256 };
