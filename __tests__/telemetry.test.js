import { TelemetrySink, sha256 } from "../src/utils/telemetry";

test("sha256 returns deterministic hash", () => {
  expect(sha256("hello")).toBe(sha256("hello"));
  expect(sha256("hello")).not.toBe(sha256("world"));
});

test("TelemetrySink records events with required fields", () => {
  const sink = new TelemetrySink({ appName: "offLLM", appVersion: "1.0.0" });
  const eventId = sink.event("model_interaction", { phase: "request" });
  const snapshot = sink.snapshot();

  expect(typeof eventId).toBe("string");
  expect(snapshot).toHaveLength(1);
  expect(snapshot[0]).toMatchObject({
    event_id: eventId,
    type: "model_interaction",
    app: { name: "offLLM", version: "1.0.0" },
  });
});
