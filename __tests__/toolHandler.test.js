import ToolHandler from "../src/core/tools/ToolHandler";

test("ToolHandler parses tool call envelopes", () => {
  const handler = new ToolHandler({ get: () => null });
  const response = 'TOOL_CALL\n{"tool":"ping","args":{}}\nEND_TOOL_CALL';
  const calls = handler.parseCalls(response);
  expect(calls).toEqual([{ ok: true, tool: "ping", args: {} }]);
});

test("ToolHandler returns invalid_json on malformed envelopes", () => {
  const handler = new ToolHandler({ get: () => null });
  const response = "TOOL_CALL\n{not json}\nEND_TOOL_CALL";
  const calls = handler.parseCalls(response);
  expect(calls[0].ok).toBe(false);
  expect(calls[0].error).toBe("invalid_json");
});

test("ToolHandler validates schema before execution", async () => {
  const registry = {
    get: (name) =>
      name === "needsFoo"
        ? {
            schema: {
              type: "object",
              properties: { foo: { type: "string" } },
              required: ["foo"],
              additionalProperties: false,
            },
            handler: async () => ({ ok: true }),
          }
        : null,
  };
  const handler = new ToolHandler(registry);
  const result = await handler.executeCall({
    ok: true,
    tool: "needsFoo",
    args: {},
  });
  expect(result.ok).toBe(false);
  expect(result.error).toBe("schema_invalid");
});

test("ToolHandler enforces capability allowlists", async () => {
  const execute = jest.fn().mockResolvedValue({ ok: true });
  const registry = {
    get: (name) =>
      name === "web_search"
        ? {
            handler: execute,
            schema: { type: "object" },
            capabilities: ["online"],
          }
        : null,
  };
  const handler = new ToolHandler(registry, { allowCapabilities: ["general"] });
  const result = await handler.executeCall({
    ok: true,
    tool: "web_search",
    args: { query: "test" },
  });

  expect(execute).not.toHaveBeenCalled();
  expect(result.ok).toBe(false);
  expect(result.error).toBe("capability_denied:web_search");
});

test("ToolHandler executes tools with valid args", async () => {
  const execute = jest.fn().mockResolvedValue({ ok: true });
  const registry = {
    get: (name) =>
      name === "ping"
        ? { handler: execute, schema: { type: "object", properties: {} } }
        : null,
  };
  const handler = new ToolHandler(registry);
  const result = await handler.executeCall({
    ok: true,
    tool: "ping",
    args: {},
  });

  expect(execute).toHaveBeenCalledWith({});
  expect(result.ok).toBe(true);
  expect(result.result).toEqual({ ok: true });
});
