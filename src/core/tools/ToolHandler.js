export default class ToolHandler {
  constructor(toolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  _scanBalanced(str, start, openChar, closeChar, initialDepth = 0) {
    let depth = initialDepth;
    let inQuote = null;
    let escape = false;
    for (let i = start; i < str.length; i++) {
      const ch = str[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
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
      const { end, closed } = this._scanBalanced(
        response,
        cursor,
        "(",
        ")",
        1,
      );
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
        let escape = false;
        let closed = false;
        while (cursor < len) {
          const ch = str[cursor];
          if (escape) {
            val += ch;
            escape = false;
            cursor++;
            continue;
          }
          if (ch === "\\") {
            escape = true;
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
        if (escape || !closed) throw new Error("Malformed argument string");
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
    const { tracer } = options;

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

      const missing = this._missingRequired(tool.parameters, args);
      if (missing.length) {
        results.push({
          role: "tool",
          name,
          content: `Error: Missing required parameters: ${missing.join(", ")}`,
        });
        continue;
      }

      if (tracer) tracer.info(`Executing ${name}`, { args });

      try {
        const output = await tool.execute(args);
        const content =
          typeof output === "string" ? output : JSON.stringify(output);
        results.push({ role: "tool", name, content });
      } catch (error) {
        results.push({
          role: "tool",
          name,
          content: `Error: ${error.message || error}`,
        });
        if (tracer) tracer.error(`Tool ${name} failed`, error);
      }
    }
    return results;
  }

  _coerceValue(value) {
    if (value === "true") return true;
    if (value === "false") return false;
    if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
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

  _missingRequired(parameters = {}, args = {}) {
    const missing = [];
    Object.entries(parameters || {}).forEach(([key, schema = {}]) => {
      if (schema.required && args[key] === undefined) {
        missing.push(key);
      }
    });
    return missing;
  }
}
