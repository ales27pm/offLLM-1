import {
  buildToolInvocationEvent,
  logTelemetryEvent,
} from "../../utils/telemetry";
import { validateToolArgs } from "./toolSchemaValidator";

export default class ToolHandler {
  constructor(toolRegistry, options = {}) {
    this.toolRegistry = toolRegistry;
    this.schemaValidator = options.schemaValidator || validateToolArgs;
  }

  _scanBalanced(str, start, openChar, closeChar, initialDepth = 0) {
    let depth = initialDepth;
    let inQuote = null;
    let escaped = false;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (inQuote) {
        if (ch === inQuote) inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === openChar) depth++;
      else if (ch === closeChar) {
        depth--;
        if (depth === 0) return { end: i, closed: true };
      }
    }
    return { end: str.length, closed: false };
  }

  parse(response) {
    const results = [];
    const marker = /TOOL_CALL:/g;
    let match;

    while ((match = marker.exec(response)) !== null) {
      let cursor = match.index + match[0].length;

      while (cursor < response.length && /\s/.test(response[cursor])) cursor++;
      const nameMatch = /[A-Za-z_][\w-]*/.exec(response.slice(cursor));
      if (!nameMatch) {
        console.warn("Malformed TOOL_CALL: missing name");
        continue;
      }
      const name = nameMatch[0];
      cursor += name.length;

      while (cursor < response.length && /\s/.test(response[cursor])) cursor++;
      if (response[cursor] !== "(") {
        console.warn(`Malformed TOOL_CALL for ${name}: missing '('`);
        continue;
      }
      cursor++; // skip opening parenthesis

      const argsStart = cursor;
      const { end, closed } = this._scanBalanced(response, cursor, "(", ")", 1);
      if (!closed) {
        console.warn(`Malformed TOOL_CALL for ${name}: unterminated args`);
        continue;
      }
      const argsStr = response.slice(argsStart, end);
      try {
        const args = this._parseArgs(argsStr.trim());
        results.push({ name, args });
      } catch (error) {
        console.warn(`Failed to parse args for ${name}:`, error);
      }
      marker.lastIndex = end + 1;
    }
    return results;
  }

  _parseArgs(str) {
    if (!str) return {};
    const args = {};
    let cursor = 0;
    const len = str.length;

    while (cursor < len) {
      while (cursor < len && /[\s,]/.test(str[cursor])) cursor++;
      if (cursor >= len) break;

      const keyMatch = /^[A-Za-z_][\w-]*/.exec(str.slice(cursor));
      if (!keyMatch) throw new Error("Malformed argument string");
      const key = keyMatch[0];
      cursor += key.length;

      while (cursor < len && /\s/.test(str[cursor])) cursor++;
      if (str[cursor] !== "=") throw new Error("Malformed argument string");
      cursor++; // skip "="
      while (cursor < len && /\s/.test(str[cursor])) cursor++;
      if (cursor >= len) throw new Error("Malformed argument string");

      let value;
      const char = str[cursor];
      if (char === '"' || char === "'") {
        const quote = char;
        cursor++;
        let val = "";
        let escaped = false;
        let closed = false;
        while (cursor < len) {
          const ch = str[cursor];
          if (escaped) {
            val += ch;
            escaped = false;
            cursor++;
            continue;
          }
          if (ch === "\\") {
            escaped = true;
            cursor++;
            continue;
          }
          if (ch === quote) {
            cursor++;
            closed = true;
            break;
          }
          val += ch;
          cursor++;
        }
        if (escaped || !closed) throw new Error("Malformed argument string");
        value = this._coerceValue(val);
      } else if (char === "{" || char === "[") {
        const startChar = char;
        const endChar = char === "{" ? "}" : "]";
        const start = cursor;
        const { end, closed } = this._scanBalanced(
          str,
          start,
          startChar,
          endChar,
        );

        if (!closed) throw new Error("Malformed argument string");
        const raw = str.slice(start, end + 1);
        try {
          value = JSON.parse(raw);
        } catch {
          value = raw;
        }
        cursor = end + 1;
      } else {
        const start = cursor;
        while (cursor < len && !/[\s,]/.test(str[cursor])) cursor++;
        const rawVal = str.slice(start, cursor).trim();
        value = this._coerceValue(rawVal);
      }

      args[key] = value;
    }
    return args;
  }

  async execute(calls, options = {}) {
    const results = [];
    const { tracer, telemetryContext, allowedCategories } = options;

    for (const { name, args } of calls) {
      const tool = this.toolRegistry.getTool(name);
      if (!tool) {
        results.push({
          role: "tool",
          name,
          content: `Error: Tool '${name}' not found`,
        });
        continue;
      }

      const toolCategories = this.toolRegistry.getToolCategories
        ? this.toolRegistry.getToolCategories(name)
        : [];
      if (
        Array.isArray(allowedCategories) &&
        allowedCategories.length > 0 &&
        !toolCategories.some((category) => allowedCategories.includes(category))
      ) {
        results.push({
          role: "tool",
          name,
          content: `Error: Tool '${name}' is not allowed for this capability scope`,
        });
        continue;
      }

      const validation = this.schemaValidator(name, args);
      if (!validation.valid) {
        results.push({
          role: "tool",
          name,
          content: `Error: Invalid parameters for '${name}': ${validation.errors.join(
            "; ",
          )}`,
        });
        continue;
      }

      if (tracer) tracer.info(`Executing ${name}`, { args });

      const startTime = Date.now();
      let success = false;
      let outputContent = "";
      let errorMessage;

      try {
        const output = await tool.execute(args);
        outputContent =
          output === undefined || output === null
            ? ""
            : typeof output === "string"
              ? output
              : (JSON.stringify(output) ?? String(output));
        results.push({ role: "tool", name, content: outputContent });
        success = true;
      } catch (error) {
        errorMessage = error?.message || error;
        results.push({
          role: "tool",
          name,
          content: `Error: ${errorMessage}`,
        });
        if (tracer) tracer.error(`Tool ${name} failed`, error);
      } finally {
        const latencyMs = Date.now() - startTime;
        void logTelemetryEvent(
          buildToolInvocationEvent({
            promptHash: telemetryContext?.promptHash,
            toolName: name,
            args,
            success,
            latencyMs,
            resultSize: outputContent.length,
            error: errorMessage,
            modelId: telemetryContext?.modelId,
          }),
        );
      }
    }
    return results;
  }

  _coerceValue(value) {
    if (value === "true") return true;
    if (value === "false") return false;
    if (
      value !== "" &&
      typeof value === "string" &&
      value.trim() !== "" &&
      !Number.isNaN(Number(value))
    ) {
      return Number(value);
    }
    if (
      typeof value === "string" &&
      (value.trim().startsWith("{") || value.trim().startsWith("["))
    ) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  }
}
