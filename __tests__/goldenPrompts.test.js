// __tests__/goldenPrompts.test.js
const fs = require("fs");
const path = require("path");

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readGoldenPrompts() {
  const goldenPath = path.join(__dirname, "..", "scripts", "eval", "golden_prompts.json");
  const raw = fs.readFileSync(goldenPath, "utf-8");
  return JSON.parse(raw);
}

describe("golden prompts", () => {
  it("loads and has at least 8 cases", () => {
    const data = readGoldenPrompts();
    expect(data && typeof data).toBe("object");
    expect(Array.isArray(data.cases)).toBe(true);
    expect(data.cases.length).toBeGreaterThanOrEqual(8);
  });

  it("each case satisfies the schema contract", () => {
    const data = readGoldenPrompts();

    data.cases.forEach((entry) => {
      expect(entry && typeof entry).toBe("object");

      // identifiers
      expect(typeof entry.id).toBe("string");
      expect(entry.id.length).toBeGreaterThan(0);

      // prompt fields
      expect(typeof entry.user_prompt).toBe("string");
      expect(entry.user_prompt.length).toBeGreaterThanOrEqual(0);
      if (typeof entry.prompt !== "undefined") {
        expect(typeof entry.prompt).toBe("string");
        // keep strict if you intend prompt == user_prompt in this dataset
        expect(entry.prompt).toBe(entry.user_prompt);
      }

      // context: strings or message-like objects
      expect(Array.isArray(entry.context)).toBe(true);
      entry.context.forEach((ctx) => {
        if (typeof ctx === "string") {
          expect(ctx.length).toBeGreaterThanOrEqual(0);
          return;
        }
        expect(isPlainObject(ctx)).toBe(true);
        expect(typeof ctx.content).toBe("string");
        if (typeof ctx.role !== "undefined") {
          expect(typeof ctx.role).toBe("string");
        }
      });

      // expected outputs
      expect(isPlainObject(entry.expected)).toBe(true);

      expect(Array.isArray(entry.expected.tool_calls)).toBe(true);
      entry.expected.tool_calls.forEach((call) => {
        expect(isPlainObject(call)).toBe(true);
        expect(typeof call.name).toBe("string");
        expect(call.name.length).toBeGreaterThan(0);
        expect(isPlainObject(call.args)).toBe(true);
      });

      expect(typeof entry.expected.json_valid).toBe("boolean");
      expect(typeof entry.expected.refusal).toBe("boolean");
      expect(typeof entry.expected.citations_required).toBe("boolean");
    });
  });

  it("optional prompt_hashes are well-formed when present", () => {
    const data = readGoldenPrompts();

    data.cases.forEach((entry) => {
      if (typeof entry.expected_prompt_hash === "undefined") return;
      expect(typeof entry.expected_prompt_hash).toBe("string");
      // sha256 hex (64 chars) is the common format; keep it strict
      expect(entry.expected_prompt_hash).toMatch(/^[a-f0-9]{64}$/i);
    });
  });
});
