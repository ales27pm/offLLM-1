import { deepRedact, redactString } from "../src/utils/telemetry";

test("redactString scrubs tokens and emails", () => {
  const input = "email test@example.com token sk-1234567890abcdef";
  const result = redactString(input);
  expect(result).not.toContain("test@example.com");
  expect(result).not.toContain("sk-1234567890abcdef");
});

test("deepRedact scrubs secret-ish fields", () => {
  const input = {
    token: "secret",
    nested: { apiKey: "secret2" },
    safe: "ok",
  };
  const result = deepRedact(input);
  expect(result.token).toBe("[REDACTED_SECRET_FIELD]");
  expect(result.nested.apiKey).toBe("[REDACTED_SECRET_FIELD]");
  expect(result.safe).toBe("ok");
});
