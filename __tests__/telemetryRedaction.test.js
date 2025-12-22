import {
  buildTelemetryEvent,
  buildPromptEvent,
  hashString,
  redactTelemetryValue,
  validateTelemetryEvent,
} from "../src/utils/telemetry";

test("redactTelemetryValue removes PII and secrets deterministically", () => {
  const input = {
    email: "user@example.com",
    phone: "+1 (415) 555-1234",
    apiKey: "apiKey-1234567890",
    bearer: "Bearer sk-test_ABC123",
    nested: {
      token: "sk-abcdef123456",
      text: "Contact me at admin@example.com",
    },
  };

  const redacted = redactTelemetryValue(input);

  expect(redacted.email).toBe("[REDACTED_EMAIL]");
  expect(redacted.phone).toBe("[REDACTED_PHONE]");
  expect(redacted.apiKey).toBe("[REDACTED]");
  expect(redacted.bearer).toBe("Bearer [REDACTED]");
  expect(redacted.nested.token).toBe("[REDACTED]");
  expect(redacted.nested.text).toBe("Contact me at [REDACTED_EMAIL]");
});

test("hashString uses SHA-256 prefix", () => {
  const digest = hashString("test-value");
  expect(digest.startsWith("sha256_")).toBe(true);
  expect(digest.length).toBeGreaterThan(10);
});

test("telemetry events validate against the schema", () => {
  const event = buildPromptEvent({
    promptHash: "sha256_test",
    promptText: "Hello",
    modelId: "model_test",
  });
  const payload = buildTelemetryEvent(event);
  const validation = validateTelemetryEvent(payload);
  expect(validation.valid).toBe(true);
});
