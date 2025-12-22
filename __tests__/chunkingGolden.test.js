import { chunkText } from "../src/retrieval/chunking";

test("chunkText is deterministic for same input + config", () => {
  const input = "A\n\nB\n\nC\n\n" + "X".repeat(5000);
  const cfg = { maxChars: 500, overlap: 50 };
  const a = chunkText(input, cfg);
  const b = chunkText(input, cfg);
  expect(a).toEqual(b);
  expect(a.length).toBeGreaterThan(1);
});

test("chunkText boundaries stable", () => {
  const input = "Para1.\n\nPara2.\n\nPara3.";
  const out = chunkText(input, { maxChars: 20, overlap: 5 });
  for (const chunk of out) {
    expect(chunk.length).toBeGreaterThan(0);
    expect(chunk).toBe(chunk.trim());
  }
});
