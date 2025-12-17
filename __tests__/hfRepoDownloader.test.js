import { ensureHuggingFaceRepoDownloaded } from "../src/utils/hfRepoDownloader";
import RNFS from "react-native-fs";

jest.mock("react-native-fs", () => ({
  DocumentDirectoryPath: "/docs",
  exists: jest.fn().mockResolvedValue(false),
  mkdir: jest.fn().mockResolvedValue(true),
  readDir: jest.fn(),
  downloadFile: jest.fn().mockImplementation(({ toFile }) => ({
    promise: Promise.resolve({ statusCode: 200, toFile }),
  })),
}));

describe("ensureHuggingFaceRepoDownloaded", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    let probeCount = 0;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        siblings: [
          {
            rfilename:
              "Dolphin3.0-Llama3.2-3B-int8.mlpackage/Data/com.apple.CoreML/model.mlmodel",
          },
          {
            rfilename:
              "Dolphin3.0-Llama3.2-3B-int8.mlpackage/Data/com.apple.CoreML/weights/weight.bin",
          },
          { rfilename: "coreml_artifacts.json" },
        ],
      }),
    });
    RNFS.readDir.mockImplementation((path) => {
      if (probeCount === 0) {
        probeCount += 1;
        return Promise.resolve([]);
      }
      if (
        path ===
        "/docs/Models/ales27pm/Dolphin3.0-CoreML/Dolphin3.0-Llama3.2-3B-int8.mlpackage/Data/com.apple.CoreML"
      ) {
        return Promise.resolve([
          {
            isFile: () => true,
            isDirectory: () => false,
            name: "model.mlmodel",
            path: `${path}/model.mlmodel`,
          },
        ]);
      }
      return Promise.resolve([
        {
          isFile: () => false,
          isDirectory: () => true,
          name: "Dolphin3.0-Llama3.2-3B-int8.mlpackage",
          path: "/docs/Models/ales27pm/Dolphin3.0-CoreML/Dolphin3.0-Llama3.2-3B-int8.mlpackage/Data/com.apple.CoreML",
        },
      ]);
    });
  });

  test("downloads siblings and returns target directory", async () => {
    const target = await ensureHuggingFaceRepoDownloaded(
      "ales27pm/Dolphin3.0-CoreML",
      { revision: "main" },
    );

    expect(target).toBe("/docs/Models/ales27pm/Dolphin3.0-CoreML");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://huggingface.co/api/models/ales27pm%2FDolphin3.0-CoreML",
    );
    expect(RNFS.downloadFile).toHaveBeenCalledTimes(3);
    expect(RNFS.downloadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        fromUrl:
          "https://huggingface.co/ales27pm/Dolphin3.0-CoreML/resolve/main/Dolphin3.0-Llama3.2-3B-int8.mlpackage/Data/com.apple.CoreML/model.mlmodel",
        toFile:
          "/docs/Models/ales27pm/Dolphin3.0-CoreML/Dolphin3.0-Llama3.2-3B-int8.mlpackage/Data/com.apple.CoreML/model.mlmodel",
      }),
    );
  });

  test("short-circuits when artifacts already exist", async () => {
    RNFS.readDir.mockImplementation(() =>
      Promise.resolve([
        {
          isFile: () => true,
          isDirectory: () => false,
          path: "/docs/Models/ales27pm/Dolphin3.0-CoreML/model.mlmodel",
          name: "model.mlmodel",
        },
      ]),
    );
    const target = await ensureHuggingFaceRepoDownloaded(
      "ales27pm/Dolphin3.0-CoreML",
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(target).toBe("/docs/Models/ales27pm/Dolphin3.0-CoreML");
  });
});
