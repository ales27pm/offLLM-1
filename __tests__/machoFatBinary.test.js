import {
  FAT_MAGIC,
  FAT_MAGIC_64,
  FAT_CIGAM,
  parseFatHeader,
  parseUniversalBinary,
  extractMachO,
  createUniversalBinary,
} from "../src/utils/machoFatBinary";

const CPU_TYPE_X86_64 = 0x01000007;
const CPU_SUBTYPE_X86_64_ALL = 0x00000003;
const CPU_TYPE_ARM64 = 0x0100000c;
const CPU_SUBTYPE_ARM64_ALL = 0x00000002;
const HEADER_SIZE = 8;
const FAT_ARCH_SIZE = 20;

const bufferToHex = (buffer) => Buffer.from(buffer).toString("hex");

describe("machoFatBinary utilities", () => {
  test("createUniversalBinary builds and parseUniversalBinary reads 32-bit fat binaries", () => {
    const x86 = Buffer.from("Test x86_64\n", "utf8");
    const arm = Buffer.from("Test arm64\n", "utf8");

    const universal = createUniversalBinary([
      {
        cpuType: CPU_TYPE_X86_64,
        cpuSubtype: CPU_SUBTYPE_X86_64_ALL,
        data: x86,
        align: 2,
      },
      {
        cpuType: CPU_TYPE_ARM64,
        cpuSubtype: CPU_SUBTYPE_ARM64_ALL,
        data: arm,
        align: 2,
      },
    ]);

    const header = parseFatHeader(universal);
    expect(header.magic).toBe(FAT_MAGIC);
    expect(header.architectureCount).toBe(2);
    expect(header.is64Bit).toBe(false);

    const parsed = parseUniversalBinary(universal);
    expect(parsed.architectures).toHaveLength(2);

    const [x86Arch, armArch] = parsed.architectures;
    expect(x86Arch.cpuType).toBe(CPU_TYPE_X86_64);
    expect(x86Arch.cpuSubtype).toBe(CPU_SUBTYPE_X86_64_ALL);
    expect(x86Arch.size).toBe(x86.length);
    expect(bufferToHex(x86Arch.data)).toBe(bufferToHex(x86));

    expect(armArch.cpuType).toBe(CPU_TYPE_ARM64);
    expect(armArch.cpuSubtype).toBe(CPU_SUBTYPE_ARM64_ALL);
    expect(armArch.size).toBe(arm.length);
    expect(bufferToHex(armArch.data)).toBe(bufferToHex(arm));
  });

  test("extractMachO returns the requested architecture buffer", () => {
    const x86 = Buffer.from("x86_64", "utf8");
    const x86Alt = Buffer.from("x86_64#2", "utf8");

    const universal = createUniversalBinary([
      { cpuType: CPU_TYPE_X86_64, cpuSubtype: 1, data: x86, align: 2 },
      { cpuType: CPU_TYPE_X86_64, cpuSubtype: 2, data: x86Alt, align: 2 },
    ]);

    const first = extractMachO(universal, {
      cpuType: CPU_TYPE_X86_64,
      cpuSubtype: 1,
    });
    expect(bufferToHex(first)).toBe(bufferToHex(x86));

    const second = extractMachO(universal, {
      cpuType: CPU_TYPE_X86_64,
      cpuSubtype: 2,
    });
    expect(bufferToHex(second)).toBe(bufferToHex(x86Alt));

    expect(() => extractMachO(universal, CPU_TYPE_X86_64)).toThrow(
      /specify cpuSubtype to disambiguate/,
    );
  });

  test("createUniversalBinary supports fat_arch_64 layouts when forced", () => {
    const payload = Buffer.from("arm64 only", "utf8");
    const universal64 = createUniversalBinary(
      [
        {
          cpuType: CPU_TYPE_ARM64,
          cpuSubtype: CPU_SUBTYPE_ARM64_ALL,
          data: payload,
          align: 3,
        },
      ],
      { forceFat64: true },
    );

    const header = parseFatHeader(universal64);
    expect(header.magic).toBe(FAT_MAGIC_64);
    expect(header.is64Bit).toBe(true);

    const parsed = parseUniversalBinary(universal64);
    expect(parsed.architectures[0].align).toBe(3);
    expect(bufferToHex(parsed.architectures[0].data)).toBe(
      bufferToHex(payload),
    );
  });

  test("parser recognises byte-swapped FAT_CIGAM headers", () => {
    const data = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]);
    const offset = HEADER_SIZE + FAT_ARCH_SIZE;
    const totalLength = offset + data.length;
    const array = new Uint8Array(totalLength);
    const view = new DataView(array.buffer);

    view.setUint32(0, FAT_MAGIC, true); // store little-endian to produce FAT_CIGAM bytes
    view.setUint32(4, 1, true);

    const tableOffset = HEADER_SIZE;
    view.setInt32(tableOffset, CPU_TYPE_ARM64, true);
    view.setInt32(tableOffset + 4, CPU_SUBTYPE_ARM64_ALL, true);
    view.setUint32(tableOffset + 8, offset, true);
    view.setUint32(tableOffset + 12, data.length, true);
    view.setUint32(tableOffset + 16, 2, true);

    array.set(data, offset);

    const header = parseFatHeader(array);
    expect(header.rawMagic).toBe(FAT_CIGAM);
    expect(header.isSwapped).toBe(true);

    const parsed = parseUniversalBinary(array);
    expect(parsed.architectures).toHaveLength(1);
    expect(bufferToHex(parsed.architectures[0].data)).toBe(bufferToHex(data));
  });

  test("supports signed cpuSubtype (e.g., -1) and numeric spec + subtype overload", () => {
    const buf = Buffer.from("any-subtype", "utf8");
    const universal = createUniversalBinary([
      { cpuType: CPU_TYPE_ARM64, cpuSubtype: -1, data: buf, align: 2 },
    ]);
    const out = extractMachO(universal, CPU_TYPE_ARM64, -1);
    expect(bufferToHex(out)).toBe(bufferToHex(buf));
  });
});
