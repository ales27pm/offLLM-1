import fs from "fs";
import VectorMemory from "../src/memory/VectorMemory";

beforeEach(() => {
  if (fs.existsSync("vector_memory.dat")) fs.unlinkSync("vector_memory.dat");
});

test("VectorMemory recall returns deterministic top-k", async () => {
  const vm = new VectorMemory({ maxMB: 1 });
  await vm.load();
  await vm.remember([
    { vector: [1, 0], content: "hello" },
    { vector: [0, 1], content: "world" },
  ]);
  const res = await vm.recall([1, 0], 1);
  expect(res[0].content).toBe("hello");
});

test("VectorMemory encrypts data at rest", async () => {
  const vm = new VectorMemory({ maxMB: 1 });
  await vm.load();
  await vm.remember([{ vector: [1, 0], content: "secret" }]);
  const raw = fs.readFileSync("vector_memory.dat", "utf8");
  expect(raw.includes("secret")).toBe(false);
});

test("VectorMemory migrations run", async () => {
  const vm = new VectorMemory({ maxMB: 1 });
  await vm.load();
  vm.data.version = 0;
  await vm._save();
  await vm.load();
  expect(vm.data.version).toBe(1);
});

test("VectorMemory enforces size cap", async () => {
  const vm = new VectorMemory({ maxMB: 0.0001 });
  await vm.load();
  for (let i = 0; i < 10; i++) {
    await vm.remember([{ vector: [i, i], content: `m${i}` }]);
  }
  expect(vm.data.items.length).toBeLessThan(10);
});

test("VectorMemory requires an encryption key in production", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalKey = process.env.MEMORY_ENCRYPTION_KEY;

  delete process.env.MEMORY_ENCRYPTION_KEY;
  process.env.NODE_ENV = "production";
  jest.resetModules();

  const VectorMemoryProd = require("../src/memory/VectorMemory").default;
  expect(() => new VectorMemoryProd()).toThrow(
    "[VectorMemory] MEMORY_ENCRYPTION_KEY is required in production.",
  );

  process.env.NODE_ENV = originalNodeEnv;
  if (originalKey === undefined) {
    delete process.env.MEMORY_ENCRYPTION_KEY;
  } else {
    process.env.MEMORY_ENCRYPTION_KEY = originalKey;
  }
  jest.resetModules();
});
