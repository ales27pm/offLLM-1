jest.mock("react-native-sqlite-storage", () => ({
  openDatabase: jest.fn(),
}));

import { HNSWVectorStore } from "../src/utils/hnswVectorStore";
import { cosineSimilarity } from "../src/utils/vectorUtils";

describe("HNSWVectorStore search", () => {
  test("returns neighbors ordered by similarity", async () => {
    const store = new HNSWVectorStore();
    store.nodeMap = new Map([
      [1, { vector: [1, 0] }],
      [2, { vector: [0.9, 0.1] }],
      [3, { vector: [0.2, 0.98] }],
    ]);
    store.index.layers = [
      new Map([
        [1, [2, 3]],
        [2, [1, 3]],
        [3, [1, 2]],
      ]),
    ];

    const results = await store._searchLayer([1, 0], 1, 0, 3);

    expect(results).toEqual([1, 2, 3]);
    const similarities = results.map((id) =>
      cosineSimilarity([1, 0], store.nodeMap.get(id).vector),
    );
    expect([...similarities]).toEqual([...similarities].sort((a, b) => b - a));
  });

  test("skips neighbors without cached vectors", async () => {
    const store = new HNSWVectorStore();
    store.nodeMap = new Map([[1, { vector: [1, 0] }]]);
    store.index.layers = [new Map([[1, [2]]])];

    const results = await store._searchLayer([1, 0], 1, 0, 1);

    expect(results).toEqual([1]);
  });

  test("returns empty array when entry point is missing", async () => {
    const store = new HNSWVectorStore();
    store.nodeMap = new Map();
    store.index.layers = [new Map()];

    const results = await store._searchLayer([1, 0], 42, 0, 3);

    expect(results).toEqual([]);
  });

  test("handles layers without connections", async () => {
    const store = new HNSWVectorStore();
    store.nodeMap = new Map([[7, { vector: [0.5, 0.5] }]]);
    store.index.layers = [new Map([[7, []]])];

    const results = await store._searchLayer([0.5, 0.5], 7, 0, 3);

    expect(results).toEqual([7]);
  });
});
