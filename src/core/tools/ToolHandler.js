import logger from "../../utils/logger";

export default class ToolHandler {
  constructor(toolRegistry) {
    this.toolRegistry = toolRegistry;
    this.callRegex = /TOOL_CALL:\s*(\w+)\s*\(([\s\S]*?)\)/g;
  }

  parse(response) {
    const results = [];
    this.callRegex.lastIndex = 0;

    let match;
    while ((match = this.callRegex.exec(response)) !== null) {
      const name = match[1];
      const argsStr = match[2];
      try {
        const args = this._parseArgsManual(argsStr);
        results.push({ name, args });
      } catch (e) {
        console.warn(`Failed to parse args for ${name}:`, e);
      }
    }
    return results;
  }

  // Robust manual parser for key=value strings supporting nested JSON/Quotes
  _parseArgsManual(str) {
    const args = {};
    let cursor = 0;
    const len = str.length;

    while (cursor < len) {
      // Eat whitespace
      while (cursor < len && /\s/.test(str[cursor])) cursor++;
      if (cursor >= len) break;

      // Read Key
      const keyStart = cursor;
      while (cursor < len && /[\w]/.test(str[cursor])) cursor++;
      const key = str.slice(keyStart, cursor);

      // Expect '='
      while (cursor < len && /\s/.test(str[cursor])) cursor++;
      if (str[cursor] !== "=") break;
      cursor++; // skip =

      // Eat whitespace
      while (cursor < len && /\s/.test(str[cursor])) cursor++;

      // Read Value
      let value;
      const char = str[cursor];

      if (char === '"' || char === "'") {
        const quote = char;
        cursor++;
        const valStart = cursor;
        while (cursor < len) {
          if (str[cursor] === quote && str[cursor - 1] !== "\\") break;
          cursor++;
        }
        value = str.slice(valStart, cursor);
        cursor++; // skip closing quote
      } else if (char === "{" || char === "[") {
        // JSON Object/Array: balance braces
        const startChar = char;
        const endChar = char === "{" ? "}" : "]";
        let balance = 0;
        const valStart = cursor;

        do {
          if (str[cursor] === startChar) balance++;
          else if (str[cursor] === endChar) balance--;
          cursor++;
        } while (cursor < len && balance > 0);

        const jsonStr = str.slice(valStart, cursor);
        try {
          value = JSON.parse(jsonStr);
        } catch {
          value = jsonStr; // Fallback to string if invalid JSON
        }
      } else {
        // Boolean, number, or unquoted string (until comma or end)
        const valStart = cursor;
        while (cursor < len && str[cursor] !== ",") cursor++;
        const rawVal = str.slice(valStart, cursor).trim();
        if (rawVal === "true") value = true;
        else if (rawVal === "false") value = false;
        else if (!isNaN(Number(rawVal))) value = Number(rawVal);
        else value = rawVal;
      }

      args[key] = value;

      // Skip comma if present
      while (cursor < len && /\s/.test(str[cursor])) cursor++;
      if (str[cursor] === ",") cursor++;
    }

    return args;
  }

  async execute(calls, options = {}) {
    const results = [];
    const { tracer } = options;

    for (const { name, args } of calls) {
      const tool = this.toolRegistry.getTool(name);
      if (!tool) {
        results.push({ name, content: `Error: Tool '${name}' not found` });
        continue;
      }

      if (tracer) tracer.info(`Executing ${name}`, { args });

      try {
        const output = await tool.execute(args);
        results.push({ name, content: output });
      } catch (error) {
        results.push({ name, content: `Error: ${error.message}` });
        if (tracer) tracer.error(`Tool ${name} failed`, error);
      }
    }
    return results;
  }
}

