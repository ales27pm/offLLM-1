const TOOL_CALL = "TOOL" + "_CALL";
const END_TOOL_CALL = "END_" + "TOOL_CALL";

const extractToolEnvelopes = (text) => {
  const s = String(text || "");
  const out = [];
  let i = 0;

  while (i < s.length) {
    const start = s.indexOf(TOOL_CALL, i);
    if (start === -1) break;
    const end = s.indexOf(END_TOOL_CALL, start);
    if (end === -1) break;

    const inner = s.slice(start + TOOL_CALL.length, end).trim();
    out.push(inner);
    i = end + END_TOOL_CALL.length;
  }
  return out;
};

const validateArgs = (schema, args) => {
  const sch = schema || {};
  if (sch.type !== "object") return { ok: true, errors: [] };
  if (args == null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, errors: ["args must be an object"] };
  }

  const props = sch.properties || {};
  const req = Array.isArray(sch.required) ? sch.required : [];
  const additional = sch.additionalProperties !== false;

  const errors = [];

  for (const r of req) {
    if (!(r in args)) errors.push(`missing required field: ${r}`);
  }

  for (const [key, value] of Object.entries(args)) {
    if (!(key in props) && !additional) {
      errors.push(`unexpected field: ${key}`);
      continue;
    }
    const ps = props[key];
    if (ps && ps.type) {
      const t = ps.type;
      if (t === "string" && typeof value !== "string")
        errors.push(`field ${key} must be string`);
      if (t === "number" && typeof value !== "number")
        errors.push(`field ${key} must be number`);
      if (t === "integer" && !Number.isInteger(value))
        errors.push(`field ${key} must be integer`);
      if (t === "boolean" && typeof value !== "boolean")
        errors.push(`field ${key} must be boolean`);
      if (
        t === "object" &&
        (typeof value !== "object" || value == null || Array.isArray(value))
      ) {
        errors.push(`field ${key} must be object`);
      }
      if (t === "array" && !Array.isArray(value))
        errors.push(`field ${key} must be array`);
    }
    if (ps && ps.enum && Array.isArray(ps.enum)) {
      if (!ps.enum.includes(value))
        errors.push(`field ${key} must be one of enum`);
    }
  }

  return { ok: errors.length === 0, errors };
};

export default class ToolHandler {
  constructor(toolRegistry, opts = {}) {
    this.registry = toolRegistry;
    this.allowCapabilities = Array.isArray(opts.allowCapabilities)
      ? opts.allowCapabilities
      : null;
  }

  parseCalls(modelText) {
    const envs = extractToolEnvelopes(modelText);
    const calls = [];

    for (const inner of envs) {
      let obj;
      try {
        obj = JSON.parse(inner);
      } catch (error) {
        calls.push({ ok: false, error: "invalid_json", raw: inner });
        continue;
      }

      if (
        !obj ||
        typeof obj.tool !== "string" ||
        typeof obj.args !== "object" ||
        obj.args == null
      ) {
        calls.push({ ok: false, error: "invalid_shape", raw: inner });
        continue;
      }

      calls.push({ ok: true, tool: obj.tool, args: obj.args });
    }

    return calls;
  }

  parse(modelText) {
    return this.parseCalls(modelText)
      .filter((call) => call.ok)
      .map((call) => ({
        name: call.tool,
        args: call.args,
      }));
  }

  async executeCall(call, opts = {}) {
    if (!call || !call.ok) {
      return { ok: false, error: call ? call.error : "invalid_call" };
    }

    const tool = this.registry.get
      ? this.registry.get(call.tool)
      : this.registry.getTool(call.tool);
    if (!tool) return { ok: false, error: `unknown_tool:${call.tool}` };

    const allowCaps = Array.isArray(opts.allowCapabilities)
      ? opts.allowCapabilities
      : this.allowCapabilities;
    if (allowCaps && tool.capabilities && tool.capabilities.length) {
      const allow = new Set(allowCaps);
      const ok = tool.capabilities.some((cap) => allow.has(cap));
      if (!ok) return { ok: false, error: `capability_denied:${call.tool}` };
    }

    const schema = tool.schema || { type: "object", properties: {} };
    const validation = validateArgs(schema, call.args);
    if (!validation.ok) {
      return { ok: false, error: "schema_invalid", details: validation.errors };
    }

    const handler = tool.handler || tool.execute;
    try {
      const result = await handler(call.args);
      return { ok: true, result };
    } catch (error) {
      return {
        ok: false,
        error: "tool_exception",
        details: String(error && error.message ? error.message : error),
      };
    }
  }

  async execute(calls, options = {}) {
    const results = [];
    for (const call of calls) {
      const normalized = call.tool
        ? call
        : { ok: true, tool: call.name, args: call.args || {} };
      const res = await this.executeCall(normalized, options);
      if (res.ok) {
        results.push({
          role: "tool",
          name: normalized.tool,
          content: JSON.stringify(res.result ?? ""),
        });
      } else {
        const details = res.details
          ? `: ${res.details.join ? res.details.join("; ") : res.details}`
          : "";
        results.push({
          role: "tool",
          name: normalized.tool,
          content: `Error: ${res.error}${details}`,
        });
      }
    }
    return results;
  }
}
