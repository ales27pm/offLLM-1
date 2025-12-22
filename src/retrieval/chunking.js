/**
 * Deterministic chunker.
 * - Normalizes newlines
 * - Splits into paragraphs
 * - Packs into fixed-size windows with overlap
 */

const normalizeText = (value) =>
  String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const splitParagraphs = (value) => {
  const normalized = normalizeText(value);
  const parts = normalized
    .split(/\n{2,}/g)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [normalized.trim()].filter(Boolean);
};

const chunkText = (text, opts = {}) => {
  const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : 1200;
  const overlap = Number.isFinite(opts.overlap) ? opts.overlap : 150;

  if (maxChars <= 0) throw new Error("chunkText: maxChars must be > 0");
  if (overlap < 0) throw new Error("chunkText: overlap must be >= 0");
  if (overlap >= maxChars)
    throw new Error("chunkText: overlap must be < maxChars");

  const paras = splitParagraphs(text);
  const chunks = [];
  let buffer = "";

  const flushBuffer = () => {
    if (!buffer.trim()) return;
    let i = 0;
    const body = buffer.trim();
    while (i < body.length) {
      const end = Math.min(i + maxChars, body.length);
      const piece = body.slice(i, end).trim();
      if (piece) chunks.push(piece);
      if (end >= body.length) break;
      i = Math.max(0, end - overlap);
    }
    buffer = "";
  };

  for (const para of paras) {
    if (!buffer) {
      buffer = para;
      continue;
    }
    if (buffer.length + 2 + para.length <= maxChars) {
      buffer = `${buffer}\n\n${para}`;
    } else {
      flushBuffer();
      buffer = para;
    }
  }
  flushBuffer();

  return chunks.map((chunk) => chunk.replace(/\s+/g, " ").trim());
};

export { chunkText, normalizeText, splitParagraphs };
