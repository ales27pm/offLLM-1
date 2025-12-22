export const DEFAULT_CHUNKING_OPTIONS = {
  maxChars: 12000,
  overlap: 200,
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const chunkText = (text, options = {}) => {
  if (!text) return [];
  const trimmedText = text.trim();
  if (!trimmedText) return [];
  const maxChars = clamp(
    Number(options.maxChars ?? DEFAULT_CHUNKING_OPTIONS.maxChars),
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const overlap = clamp(
    Number(options.overlap ?? DEFAULT_CHUNKING_OPTIONS.overlap),
    0,
    maxChars - 1,
  );
  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    let end = Math.min(cursor + maxChars, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > cursor + Math.floor(maxChars * 0.5)) {
        end = lastSpace;
      }
    }
    const slice = text.slice(cursor, end).trim();
    if (slice) {
      chunks.push(slice);
    }
    if (end >= text.length) break;
    cursor = Math.max(cursor + 1, end - overlap);
  }

  return chunks.length ? chunks : [trimmedText];
};
