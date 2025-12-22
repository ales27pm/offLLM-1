import logger from "../src/utils/logger";
import {
  buildPromptEvent,
  buildRetrievalEvent,
  buildTelemetryEvent,
  buildToolInvocationEvent,
  hashString,
  logTelemetryEvent,
  redactTelemetryValue,
  validateTelemetryEvent,
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
    modelId: "model-test",
  });
  expect(event.tool_name).toBe("demo");
  expect(event.tool_args_hash).toContain("sha256_");
  expect(event.model_id).toBe("model-test");
});

test("telemetry builders set schema fields via buildTelemetryEvent", () => {
  const base = buildPromptEvent({
    promptHash: "hash",
    promptText: "hello",
    modelId: "model-test",
  });
  const payload = buildTelemetryEvent(base);
  expect(payload.schema_version).toBeDefined();
  expect(payload.event_type).toBe("prompt_received");
});

test("validateTelemetryEvent rejects invalid payloads", () => {
  const invalid = {
    schema_version: 123,
    event_type: "unknown",
    timestamp: "now",
  };
  const result = validateTelemetryEvent(invalid);
  expect(result.valid).toBe(false);
  expect(result.errors.length).toBeGreaterThan(0);
});

test("validateTelemetryEvent accepts retrieval payloads", () => {
  const event = buildRetrievalEvent({
    query: "test",
    resultIds: ["1"],
    maxResults: 1,
    latencyMs: 5,
    candidateIds: ["1"],
    candidateScores: [0.5],
    modelId: "model-test",
  });
  const payload = buildTelemetryEvent(event);
  const result = validateTelemetryEvent(payload);
  expect(result.valid).toBe(true);
});

test("logTelemetryEvent skips invalid events and logs an error", async () => {
  const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
  const result = await logTelemetryEvent({ prompt_hash: "missing_type" });
  expect(result).toBeNull();
  expect(errorSpy).toHaveBeenCalled();
  errorSpy.mockRestore();
});

test("logTelemetryEvent enqueues valid events", async () => {
  const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
  const event = buildToolInvocationEvent({
    promptHash: "abc",
    toolName: "demo",
    args: { q: "test" },
    success: true,
    latencyMs: 10,
    resultSize: 5,
    modelId: "model-test",
  });
  const result = await logTelemetryEvent(event);
  expect(result).toContain("events.jsonl");
  expect(errorSpy).not.toHaveBeenCalled();
  errorSpy.mockRestore();
});
