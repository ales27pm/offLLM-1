export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return magA === 0 || magB === 0 ? 0 : dot / (magA * magB);
}

export function quantizeVector(vector, bits = 4) {
  if (!vector) return [];
  const maxVal = Math.max(...vector.map(Math.abs));
  if (maxVal === 0) return new Array(vector.length).fill(0);
  const scale = Math.pow(2, bits - 1) - 1;
  return vector.map((v) => Math.round((v / maxVal) * scale));
}

