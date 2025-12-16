import ProsodyDetector from "../src/emotion/ProsodyDetector";

test("ProsodyDetector disabled returns null emotion", async () => {
  const det = new ProsodyDetector();
  const res = await det.analyze(new Float32Array([0, 0, 0]));
  expect(res.emotion).toBeNull();
});

test("ProsodyDetector confidence gating", async () => {
  process.env.EMOTION_AUDIO_ENABLED = "true";
  const det = new ProsodyDetector();
  const res = await det.analyze(new Float32Array([1, 1, 1]));
  expect(res.confidence).toBeGreaterThan(0);
});
