import { cosineSimilarity, dotProduct } from "./vectorUtils";

export function applySparseAttention(
  queryVector,
  contextVectors,
  options = {},
) {
  const { topK = 5, threshold = 0.5, useCosine = true } = options;

  if (!contextVectors || contextVectors.length === 0) {
    return [];
  }

  // Calculate attention scores
  const scores = contextVectors.map((vector, index) => {
    let score;

    if (useCosine) {
      score = cosineSimilarity(queryVector, vector);
    } else {
      score = dotProduct(queryVector, vector);
    }

    return { index, score };
  });

  // Filter by threshold and sort by score
  const filteredScores = scores
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score);

  // Return top K results
  return filteredScores.slice(0, topK).map((item) => item.index);
}

export function applyBlockSparseAttention(
  queryVector,
  contextVectors,
  blockSize = 64,
) {
  if (!contextVectors || contextVectors.length === 0) {
    return [];
  }

  const numBlocks = Math.ceil(contextVectors.length / blockSize);
  const blockScores = [];

  // Calculate score for each block
  for (let i = 0; i < numBlocks; i++) {
    const start = i * blockSize;
    const end = Math.min(start + blockSize, contextVectors.length);

    const blockVectors = contextVectors.slice(start, end);
    const blockRepresentative = averageVectors(blockVectors);

    const score = cosineSimilarity(queryVector, blockRepresentative);
    blockScores.push({ blockIndex: i, score, start, end });
  }

  // Sort blocks by score and select top ones
  blockScores.sort((a, b) => b.score - a.score);
  const selectedBlocks = blockScores.slice(0, Math.ceil(numBlocks / 2));

  // Get all vectors from selected blocks
  const selectedIndices = [];
  for (const block of selectedBlocks) {
    for (let i = block.start; i < block.end; i++) {
      selectedIndices.push(i);
    }
  }

  return selectedIndices;
}

export function applyHierarchicalSparseAttention(
  queryVector,
  contextVectors,
  options = {},
) {
  const { numClusters = 3, topKPerCluster = 2 } = options;

  if (!contextVectors || contextVectors.length === 0) {
    return [];
  }

  // Cluster the context vectors
  const clusters = clusterVectors(contextVectors, numClusters);

  // For each cluster, find the most relevant vectors to the query
  const selectedIndices = [];

  for (const cluster of clusters) {
    const clusterScores = cluster.indices.map((index) => {
      const score = cosineSimilarity(queryVector, contextVectors[index]);
      return { index, score };
    });

    clusterScores.sort((a, b) => b.score - a.score);

    // Add top K vectors from this cluster
    selectedIndices.push(
      ...clusterScores.slice(0, topKPerCluster).map((item) => item.index),
    );
  }

  return selectedIndices;
}

function clusterVectors(vectors, numClusters) {
  if (vectors.length <= numClusters) {
    return vectors.map((vector, index) => ({
      centroid: vector,
      indices: [index],
    }));
  }

  // K-means++ centroid initialization
  let centroids = [];
  const firstIndex = Math.floor(Math.random() * vectors.length);
  centroids.push(vectors[firstIndex]);

  while (centroids.length < numClusters) {
    const distances = vectors.map((vector) => {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const dist = vector.reduce(
          (sum, val, idx) => sum + Math.pow(val - centroid[idx], 2),
          0,
        );
        if (dist < minDist) minDist = dist;
      }
      return minDist;
    });

    const totalDist = distances.reduce((a, b) => a + b, 0);
    let r = Math.random() * totalDist;
    let nextIndex = 0;
    for (let i = 0; i < distances.length; i++) {
      r -= distances[i];
      if (r <= 0) {
        nextIndex = i;
        break;
      }
    }
    centroids.push(vectors[nextIndex]);
  }

  let clusters = Array(numClusters)
    .fill()
    .map(() => ({ indices: [] }));
  let changed = true;
  let iterations = 0;

  while (changed && iterations < 10) {
    // Reset clusters
    clusters = Array(numClusters)
      .fill()
      .map(() => ({ indices: [] }));

    // Assign each vector to the nearest centroid
    for (let i = 0; i < vectors.length; i++) {
      let minDistance = Infinity;
      let bestCluster = 0;

      for (let j = 0; j < numClusters; j++) {
        const distance = euclideanDistance(vectors[i], centroids[j]);
        if (distance < minDistance) {
          minDistance = distance;
          bestCluster = j;
        }
      }

      clusters[bestCluster].indices.push(i);
    }

    // Update centroids
    changed = false;
    for (let j = 0; j < numClusters; j++) {
      if (clusters[j].indices.length > 0) {
        const newCentroid = averageVectors(
          clusters[j].indices.map((index) => vectors[index]),
        );

        if (euclideanDistance(newCentroid, centroids[j]) > 0.001) {
          changed = true;
          centroids[j] = newCentroid;
        }
      }
    }

    iterations++;
  }

  // Add centroids to clusters
  return clusters.map((cluster, i) => ({
    centroid: centroids[i],
    indices: cluster.indices,
  }));
}

function averageVectors(vectors) {
  if (!vectors || vectors.length === 0) {
    return [];
  }

  const dimension = vectors[0].length;
  const result = new Array(dimension).fill(0);

  for (const vector of vectors) {
    for (let i = 0; i < dimension; i++) {
      result[i] += vector[i];
    }
  }

  return result.map((sum) => sum / vectors.length);
}

function euclideanDistance(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return Infinity;
  }

  return Math.sqrt(
    vecA.reduce((sum, a, i) => sum + Math.pow(a - vecB[i], 2), 0),
  );
}



