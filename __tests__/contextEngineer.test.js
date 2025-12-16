import { ContextEngineer } from "../src/services/contextEngineer";

describe("ContextEngineer sparse retrieval", () => {
  const createEngineer = ({ vectorStore, llmService, contextEvaluator } = {}) =>
    new ContextEngineer({
      vectorStore,
      llmService: llmService ?? {
        embed: jest.fn(),
        generate: jest.fn(),
      },
      contextEvaluator: contextEvaluator ?? {
        evaluateContext: jest.fn(),
        prioritizeContext: jest.fn(),
      },
    });

  test("uses sparse retrieval when available", async () => {
    const sparse = jest.fn().mockResolvedValue([{ id: "a" }]);
    const dense = jest.fn().mockResolvedValue([]);
    const store = {
      searchVectorsSparse: sparse,
      searchVectors: dense,
    };
    const engineer = createEngineer({ vectorStore: store });

    const result = await engineer._retrieveRelevantChunksSparse([0.1, 0.2], 3);

    expect(sparse).toHaveBeenCalledWith([0.1, 0.2], 3, {
      useHierarchical: true,
      numClusters: 3,
    });
    expect(result).toEqual([{ id: "a" }]);
    expect(dense).not.toHaveBeenCalled();
  });

  test("falls back to dense search when sparse retrieval fails", async () => {
    const sparse = jest.fn().mockRejectedValue(new Error("fail"));
    const dense = jest.fn().mockResolvedValue([{ id: "fallback" }]);
    const store = {
      searchVectorsSparse: sparse,
      searchVectors: dense,
    };
    const engineer = createEngineer({ vectorStore: store });
    const consoleWarn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    const result = await engineer._retrieveRelevantChunksSparse([0.4], 2);

    expect(dense).toHaveBeenCalledWith([0.4], 2);
    expect(result).toEqual([{ id: "fallback" }]);

    consoleWarn.mockRestore();
  });

  test("falls back to dense search when sparse retrieval is unavailable", async () => {
    const dense = jest.fn().mockResolvedValue([{ id: "dense" }]);
    const store = {
      searchVectors: dense,
    };
    const engineer = createEngineer({ vectorStore: store });

    const result = await engineer._retrieveRelevantChunksSparse([0.2], 2);

    expect(dense).toHaveBeenCalledWith([0.2], 2);
    expect(result).toEqual([{ id: "dense" }]);
  });

  test("returns empty array when dense search fails", async () => {
    const error = new Error("boom");
    const store = {
      searchVectors: jest.fn().mockRejectedValue(error),
    };
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const engineer = createEngineer({ vectorStore: store });

    await expect(
      engineer._retrieveRelevantChunksSparse([0.3], 1),
    ).resolves.toEqual([]);

    expect(store.searchVectors).toHaveBeenCalledWith([0.3], 1);
    consoleError.mockRestore();
  });

  test("throws when vector store is missing", () => {
    expect(() =>
      createEngineer({
        vectorStore: null,
      }),
    ).toThrow("ContextEngineer requires a vectorStore");
  });
});
