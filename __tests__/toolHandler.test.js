import ToolHandler from "../src/core/tools/ToolHandler";

const handler = new ToolHandler({ getTool: () => null });

test("ToolHandler parses mixed-quote arguments", () => {
  const args = handler._parseArgs(
    "a='one' b=\"two and \\\"quote\\\"\" c='single \\'quote\\'' d=\"path \\\\test\"",
  );
  expect(args).toEqual({
    a: "one",
    b: 'two and "quote"',
    c: "single 'quote'",
    d: "path \\test",
  });
});

test("ToolHandler parses nested JSON and paths", () => {
  const args = handler._parseArgs(
    'config=\'{"a":1,"b":{"c":2}}\' path="C:\\\\Program Files\\\\App"',
  );
  expect(args).toEqual({
    config: { a: 1, b: { c: 2 } },
    path: "C:\\Program Files\\App",
  });
});

test("ToolHandler throws on malformed args", () => {
  expect(() => handler._parseArgs('a=\'one b="two"')).toThrow(
    "Malformed argument string",
  );
  expect(() => handler._parseArgs('json=\'{"a":1')).toThrow(
    "Malformed argument string",
  );
});

test("ToolHandler parses empty argument lists", () => {
  const parsed = handler.parse("TOOL_CALL: ping()");
  expect(parsed).toEqual([{ name: "ping", args: {} }]);
});

test("ToolHandler parses argument lists with extra whitespace", () => {
  const parsed1 = handler.parse("TOOL_CALL: ping(   )");
  expect(parsed1).toEqual([{ name: "ping", args: {} }]);

  const parsed2 = handler.parse("TOOL_CALL:   ping (   )");
  expect(parsed2).toEqual([{ name: "ping", args: {} }]);

  const parsed3 = handler.parse("TOOL_CALL: ping(\n\t )");
  expect(parsed3).toEqual([{ name: "ping", args: {} }]);
});

test("ToolHandler parses arguments containing parentheses", () => {
  const parsed = handler.parse('TOOL_CALL: find(query="a(b)c")');
  expect(parsed).toEqual([
    {
      name: "find",
      args: { query: "a(b)c" },
    },
  ]);
});

test("ToolHandler parses sequential tool calls", () => {
  const parsed = handler.parse(
    "TOOL_CALL: first(value=\"(1+2)\")\nTOOL_CALL: second(flag='done')",
  );
  expect(parsed).toEqual([
    {
      name: "first",
      args: { value: "(1+2)" },
    },
    {
      name: "second",
      args: { flag: "done" },
    },
  ]);
});

test("ToolHandler executes zero-argument tools", async () => {
  const execute = jest.fn().mockResolvedValue({ ok: true });
  const registry = {
    getTool: (name) => (name === "ping" ? { execute } : null),
  };
  const localHandler = new ToolHandler(registry);

  const result = await localHandler.execute([{ name: "ping", args: {} }]);

  expect(execute).toHaveBeenCalledWith({});
  expect(result).toEqual([
    { role: "tool", name: "ping", content: JSON.stringify({ ok: true }) },
  ]);
});

test("ToolHandler reports missing required parameters without executing the tool", async () => {
  let executedCount = 0;
  const registry = {
    getTool: (name) =>
      name === "needsFoo"
        ? {
            name: "needsFoo",
            parameters: { foo: { type: "string", required: true } },
            async execute() {
              executedCount += 1;
              return { ok: true };
            },
          }
        : null,
  };
  const handlerWithRequired = new ToolHandler(registry);

  const result = await handlerWithRequired.execute([
    { name: "needsFoo", args: {} },
  ]);

  expect(executedCount).toBe(0);
  expect(result).toEqual([
    {
      role: "tool",
      name: "needsFoo",
      content: "Error: Missing required parameters: foo",
    },
  ]);
});
