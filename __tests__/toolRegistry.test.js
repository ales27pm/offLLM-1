jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

jest.mock("../src/tools/iosTools", () => ({
  toolOne: { name: "tool_one", execute: jest.fn() },
  toolTwo: { name: "tool_two", execute: jest.fn() },
  notATool: { foo: "bar" },
}));

import { toolRegistry } from "../src/core/tools/ToolRegistry";

test("toolRegistry auto registers tools with execute", () => {
  expect(toolRegistry.getTool("tool_one")).toBeDefined();
  expect(toolRegistry.getTool("tool_two")).toBeDefined();
  expect(toolRegistry.getAvailableTools().length).toBe(2);
});

test("unregister and invalid registration", () => {
  const temp = { name: "temp_tool", execute: jest.fn() };
  toolRegistry.register(temp.name, temp);
  expect(toolRegistry.getTool("temp_tool")).toBeDefined();
  expect(toolRegistry.unregister("temp_tool")).toBe(true);
  expect(() => toolRegistry.register("bad", {})).toThrow(
    "Invalid tool bad: missing execute()",
  );
});
