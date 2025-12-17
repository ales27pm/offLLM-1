export function buildPrompt(opts: {
  query: string;
  textEmotion: string | null;
  audioEmotion: string | null;
  context: string;
}) {
  const emotion = opts.audioEmotion ?? opts.textEmotion;
  let prompt = opts.query;
  if (emotion) prompt = `The user sounds ${emotion}. ${prompt}`;
  if (opts.context) prompt = `Context:\n${opts.context}\n\n${prompt}`;
  return prompt;
}
