import {
  buildToolInvocationEvent,
  hashString,
  redactTelemetryValue,
} from "../src/utils/telemetry";

test("hashString returns deterministic hash", () => {
  expect(hashString("hello")).toBe(hashString("hello"));
  expect(hashString("hello")).not.toBe(hashString("world"));
});

test("redactTelemetryValue masks sensitive fields", () => {
  const redacted = redactTelemetryValue({
    email: "person@example.com",
    token: "example_token_value",
    phone: "+1 (555) 123-4567",
  });
  expect(redacted.email).toBe("[REDACTED_EMAIL]");
  expect(redacted.token).toBe("[REDACTED]");
  expect(redacted.phone).toBe("[REDACTED_PHONE]");
});

test("buildToolInvocationEvent includes hashes", () => {
  const event = buildToolInvocationEvent({
    promptHash: "abc",
    toolName: "demo",
    args: { q: "test" },
    success: true,
    latencyMs: 10,
    resultSize: 5,
  });
  expect(event.tool_name).toBe("demo");
  expect(event.tool_args_hash).toContain("sha256_");
});
