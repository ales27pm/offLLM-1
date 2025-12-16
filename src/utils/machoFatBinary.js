/*
 * Utilities for working with Mach-O universal (fat) binaries. The module can
 * parse the fat header/architecture table, extract individual Mach-O objects,
 * and build new universal binaries from architecture-specific Mach-O buffers.
 *
 * The implementation mirrors the structures defined in mach-o/fat.h:
 *   struct fat_header { uint32_t magic; uint32_t nfat_arch; };
 *   struct fat_arch { cpu_type_t cputype; cpu_subtype_t cpusubtype;
 *                     uint32_t offset; uint32_t size; uint32_t align; };
 *   struct fat_arch_64 { ... uint64_t offset; uint64_t size; ... };
 *
 * Apple stores these structures in big-endian order (`FAT_MAGIC`) or the
 * byte-swapped variant (`FAT_CIGAM`). The helper functions below transparently
 * handle both encodings and surface typed architecture metadata to callers.
 */

const hasBuffer =
  typeof Buffer !== "undefined" && typeof Buffer.isBuffer === "function";

export const FAT_MAGIC = 0xcafebabe;
export const FAT_CIGAM = 0xbebafeca;
export const FAT_MAGIC_64 = 0xcafebabf;
export const FAT_CIGAM_64 = 0xbfbafeca;

const MAX_UINT32 = 0xffffffffn;
const HEADER_SIZE = 8;
const FAT_ARCH_SIZE = 20;
const FAT_ARCH64_SIZE = 32;

const toUint8Array = (value, label) => {
  if (value == null) {
    throw new TypeError(
      `${label} must be a Buffer, Uint8Array, or ArrayBuffer`,
    );
  }

  if (hasBuffer && Buffer.isBuffer(value)) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  throw new TypeError(`${label} must be a Buffer, Uint8Array, or ArrayBuffer`);
};

const toBinaryView = (value, label) => {
  const array = toUint8Array(value, label);
  return {
    array,
    view: new DataView(array.buffer, array.byteOffset, array.byteLength),
  };
};

const readUInt32 = (view, offset, swapped) => view.getUint32(offset, swapped);
const readInt32 = (view, offset, swapped) => view.getInt32(offset, swapped);

const readUInt64 = (view, offset, swapped) => {
  if (typeof view.getBigUint64 !== "function") {
    throw new Error(
      "BigInt DataView helpers are not available in this environment",
    );
  }
  return view.getBigUint64(offset, swapped);
};

const writeUInt32 = (view, offset, value, swapped) =>
  view.setUint32(offset, value, swapped);
const writeInt32 = (view, offset, value, swapped) =>
  view.setInt32(offset, value, swapped);

const writeUInt64 = (view, offset, value, swapped) => {
  if (typeof view.setBigUint64 !== "function") {
    throw new Error(
      "BigInt DataView helpers are not available in this environment",
    );
  }
  view.setBigUint64(offset, value, swapped);
};

const toSafeNumber = (value, label) => {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${label} must be a finite positive integer`);
    }
    if (!Number.isInteger(value)) {
      throw new RangeError(`${label} must be an integer value`);
    }
    return value;
  }

  if (typeof value !== "bigint") {
    throw new TypeError(`${label} must be a number or bigint`);
  }

  if (value < 0n) {
    throw new RangeError(`${label} must be a finite positive integer`);
  }

  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `${label} does not fit within JavaScript's safe integer range`,
    );
  }

  return Number(value);
};

const INT32_MIN = -0x80000000;
const UINT32_MAX = 0xffffffff;
const toSignedInt32 = (value, label) => {
  let numeric;
  if (typeof value === "bigint") {
    if (value < BigInt(INT32_MIN) || value > BigInt(UINT32_MAX)) {
      throw new RangeError(`${label} must fit in a 32-bit integer`);
    }
    numeric = Number(value);
  } else if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new RangeError(`${label} must be a finite integer`);
    }
    if (value < INT32_MIN || value > UINT32_MAX) {
      throw new RangeError(`${label} must fit in a 32-bit integer`);
    }
    numeric = value;
  } else {
    throw new TypeError(`${label} must be a number or bigint`);
  }

  return numeric | 0;
};

const normaliseAlignment = (align) => {
  if (!Number.isInteger(align) || align < 0) {
    throw new RangeError(
      `Alignment exponent must be a non-negative integer, received ${align}`,
    );
  }
  return align;
};

const alignmentExponentFromBytes = (alignment, label) => {
  if (typeof alignment === "bigint") {
    if (alignment <= 0n || (alignment & (alignment - 1n)) !== 0n) {
      throw new RangeError(`${label} must be a positive power of two`);
    }
    let exponent = 0;
    let value = alignment;
    while (value > 1n) {
      value >>= 1n;
      exponent += 1;
    }
    return exponent;
  }

  if (!Number.isInteger(alignment) || alignment <= 0) {
    throw new RangeError(`${label} must be a positive power of two`);
  }

  if ((alignment & (alignment - 1)) !== 0) {
    throw new RangeError(`${label} must be a power of two`);
  }

  let exponent = 0;
  let value = alignment >>> 0;
  while (value > 1) {
    value >>>= 1;
    exponent += 1;
  }
  return exponent;
};

const computeAlignmentBytes = (align) => {
  const alignment = 1n << BigInt(align);
  if (alignment <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(alignment);
  }
  return alignment;
};

const alignBigInt = (value, alignment) => {
  if (alignment <= 1n) {
    return value;
  }
  const remainder = value % alignment;
  if (remainder === 0n) {
    return value;
  }
  return value + (alignment - remainder);
};

const bigIntLengthToNumber = (value, label) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(
      `${label} is too large to represent as a JavaScript number`,
    );
  }
  return Number(value);
};

const assertUniqueArchitectures = (architectures) => {
  const seen = new Set();
  for (const { cpuType, cpuSubtype } of architectures) {
    const key = `${cpuType}:${cpuSubtype}`;
    if (seen.has(key)) {
      throw new Error(
        `Duplicate architecture entry detected for cpuType=${cpuType} cpuSubtype=${cpuSubtype}`,
      );
    }
    seen.add(key);
  }
};

const normaliseCpuField = (value) => value >>> 0;

const maybeNormaliseCpuSpecField = (value, label) => {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return toSignedInt32(value, label);
  }
  throw new TypeError(`${label} must be a number or bigint`);
};

const parseHeaderFromView = (view) => {
  if (view.byteLength < HEADER_SIZE) {
    throw new Error("Buffer is too small to contain a fat header");
  }

  const rawMagic = readUInt32(view, 0, false);
  let isSwapped = false;
  let is64Bit = false;
  let canonicalMagic = rawMagic;

  switch (rawMagic) {
    case FAT_MAGIC:
      canonicalMagic = FAT_MAGIC;
      break;
    case FAT_MAGIC_64:
      canonicalMagic = FAT_MAGIC_64;
      is64Bit = true;
      break;
    case FAT_CIGAM:
      canonicalMagic = FAT_MAGIC;
      isSwapped = true;
      break;
    case FAT_CIGAM_64:
      canonicalMagic = FAT_MAGIC_64;
      is64Bit = true;
      isSwapped = true;
      break;
    default:
      throw new Error(
        `Unrecognised Mach-O universal binary magic: 0x${rawMagic.toString(16)}`,
      );
  }

  const architectureCount = readUInt32(view, 4, isSwapped);

  return {
    magic: canonicalMagic,
    rawMagic,
    architectureCount,
    is64Bit,
    isSwapped,
  };
};

export const parseFatHeader = (buffer) => {
  const { view } = toBinaryView(buffer, "buffer");
  return parseHeaderFromView(view);
};

export const parseUniversalBinary = (buffer) => {
  const { array, view } = toBinaryView(buffer, "buffer");
  const header = parseHeaderFromView(view);

  const entrySize = header.is64Bit ? FAT_ARCH64_SIZE : FAT_ARCH_SIZE;
  if (
    header.architectureCount >
    Math.floor((Number.MAX_SAFE_INTEGER - HEADER_SIZE) / entrySize)
  ) {
    throw new Error("Fat binary declares an excessive number of architectures");
  }
  const requiredSize = HEADER_SIZE + header.architectureCount * entrySize;
  if (view.byteLength < requiredSize) {
    throw new Error(
      `Fat binary header declares ${header.architectureCount} architectures but the buffer is too small`,
    );
  }

  const architectures = [];
  let tableOffset = HEADER_SIZE;

  for (let index = 0; index < header.architectureCount; index += 1) {
    const cpuType = readInt32(view, tableOffset, header.isSwapped);
    const cpuSubtype = readInt32(view, tableOffset + 4, header.isSwapped);

    let offsetValue;
    let sizeValue;
    let cursor = tableOffset + 8;

    if (header.is64Bit) {
      offsetValue = readUInt64(view, cursor, header.isSwapped);
      sizeValue = readUInt64(view, cursor + 8, header.isSwapped);
      cursor += 16;
    } else {
      offsetValue = BigInt(readUInt32(view, cursor, header.isSwapped));
      sizeValue = BigInt(readUInt32(view, cursor + 4, header.isSwapped));
      cursor += 8;
    }

    const align = readUInt32(view, cursor, header.isSwapped);
    cursor += 4;

    if (header.is64Bit) {
      cursor += 4; // reserved field
    }

    tableOffset += entrySize;

    const offset = toSafeNumber(offsetValue, "offset");
    const size = toSafeNumber(sizeValue, "size");

    if (offset + size > array.byteLength) {
      throw new Error(
        `Fat binary architecture index ${index} exceeds buffer bounds (offset=${offset} size=${size})`,
      );
    }

    const alignmentExponent = normaliseAlignment(align);
    const alignmentBytes = computeAlignmentBytes(alignmentExponent);

    const offsetBigInt = BigInt(offset);
    const alignmentBigInt = 1n << BigInt(alignmentExponent);
    if (offsetBigInt % alignmentBigInt !== 0n) {
      throw new Error(
        `Architecture index ${index} offset ${offset} does not respect 2^${alignmentExponent} alignment`,
      );
    }

    architectures.push({
      cpuType,
      cpuSubtype,
      offset,
      size,
      align: alignmentExponent,
      alignmentBytes,
      data: array.subarray(offset, offset + size),
    });
  }

  assertUniqueArchitectures(architectures);

  return {
    ...header,
    architectures,
  };
};

const resolveArchitectureSpec = (spec, maybeSubtype) => {
  if (typeof spec === "number" || typeof spec === "bigint") {
    return {
      cpuType: toSignedInt32(spec, "architecture spec cpuType"),
      cpuSubtype: maybeNormaliseCpuSpecField(
        maybeSubtype,
        "architecture spec cpuSubtype",
      ),
    };
  }

  if (typeof spec === "object" && spec !== null) {
    const cpuType = maybeNormaliseCpuSpecField(
      spec.cpuType,
      "architecture spec cpuType",
    );
    const cpuSubtype = maybeNormaliseCpuSpecField(
      spec.cpuSubtype,
      "architecture spec cpuSubtype",
    );

    return {
      cpuType,
      cpuSubtype,
      index:
        typeof spec.index === "number" && Number.isInteger(spec.index)
          ? spec.index
          : undefined,
    };
  }

  throw new TypeError(
    "Architecture spec must be a cpuType number or bigint, { cpuType, cpuSubtype }, or { index } object",
  );
};

export const extractMachO = (buffer, spec, maybeSubtype) => {
  const parsed = parseUniversalBinary(buffer);
  const criteria = resolveArchitectureSpec(spec, maybeSubtype);

  if (typeof criteria.index === "number") {
    const { index } = criteria;
    if (index < 0 || index >= parsed.architectures.length) {
      throw new RangeError(
        `Requested architecture index ${index} is out of bounds`,
      );
    }
    return parsed.architectures[index].data;
  }

  if (typeof criteria.cpuType !== "number") {
    throw new TypeError(
      "Architecture spec must include a cpuType when index is not provided",
    );
  }

  const cpuTypeKey = normaliseCpuField(criteria.cpuType);
  const matches = parsed.architectures.filter(
    (arch) => normaliseCpuField(arch.cpuType) === cpuTypeKey,
  );

  if (matches.length === 0) {
    throw new Error(`No Mach-O object found for cpuType=${criteria.cpuType}`);
  }

  if (typeof criteria.cpuSubtype === "number") {
    const subtypeKey = normaliseCpuField(criteria.cpuSubtype);
    const match = matches.find(
      (arch) => normaliseCpuField(arch.cpuSubtype) === subtypeKey,
    );
    if (!match) {
      throw new Error(
        `No Mach-O object found for cpuType=${criteria.cpuType} cpuSubtype=${criteria.cpuSubtype}`,
      );
    }
    return match.data;
  }

  if (matches.length > 1) {
    throw new Error(
      `Multiple Mach-O objects share cpuType=${criteria.cpuType}; specify cpuSubtype to disambiguate`,
    );
  }

  return matches[0].data;
};

const computeLayout = (entries, entrySize) => {
  let offset = BigInt(HEADER_SIZE + entrySize * entries.length);
  const layout = [];

  for (const entry of entries) {
    const alignment = 1n << BigInt(entry.align);
    offset = alignBigInt(offset, alignment);

    const size = BigInt(entry.data.byteLength ?? entry.data.length);

    layout.push({
      offset,
      size,
      align: entry.align,
      data: entry.data,
      cpuType: entry.cpuType,
      cpuSubtype: entry.cpuSubtype,
    });

    offset += size;
  }

  return { layout, totalSize: offset };
};

const normaliseEntry = (entry, index, defaultAlign) => {
  if (!entry || typeof entry !== "object") {
    throw new TypeError(
      `Architecture entry at index ${index} must be an object`,
    );
  }

  const data = toUint8Array(entry.data, `architectures[${index}].data`);
  const cpuType = toSignedInt32(
    entry.cpuType,
    `architectures[${index}].cpuType`,
  );
  const cpuSubtype = toSignedInt32(
    entry.cpuSubtype,
    `architectures[${index}].cpuSubtype`,
  );

  let align = entry.align;
  if (align == null && entry.alignmentBytes != null) {
    align = alignmentExponentFromBytes(
      entry.alignmentBytes,
      `architectures[${index}].alignmentBytes`,
    );
  } else if (align == null && entry.alignment != null) {
    align = alignmentExponentFromBytes(
      entry.alignment,
      `architectures[${index}].alignment`,
    );
  }

  if (align == null) {
    align = normaliseAlignment(defaultAlign);
  } else {
    align = normaliseAlignment(align);
  }

  return { data, cpuType, cpuSubtype, align };
};

const createResultBuffer = (array) => {
  if (hasBuffer) {
    return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  }
  return array;
};

export const createUniversalBinary = (architectures, options = {}) => {
  if (!Array.isArray(architectures) || architectures.length === 0) {
    throw new TypeError(
      "createUniversalBinary expects a non-empty array of architectures",
    );
  }

  const defaultAlign = options.defaultAlign != null ? options.defaultAlign : 14;
  const entries = architectures.map((entry, index) =>
    normaliseEntry(entry, index, defaultAlign),
  );

  assertUniqueArchitectures(entries);

  const entrySize32 = FAT_ARCH_SIZE;
  const entrySize64 = FAT_ARCH64_SIZE;

  let use64Bit = options.forceFat64 === true;
  let { layout, totalSize } = computeLayout(
    entries,
    use64Bit ? entrySize64 : entrySize32,
  );

  if (!use64Bit) {
    const needs64 = layout.some(
      (item) => item.offset > MAX_UINT32 || item.size > MAX_UINT32,
    );
    if (needs64) {
      use64Bit = true;
      ({ layout, totalSize } = computeLayout(entries, entrySize64));
    }
  }

  const totalSizeNumber = bigIntLengthToNumber(totalSize, "fat binary size");
  const array = new Uint8Array(totalSizeNumber);
  const view = new DataView(array.buffer, array.byteOffset, array.byteLength);

  const magic = use64Bit ? FAT_MAGIC_64 : FAT_MAGIC;
  writeUInt32(view, 0, magic, false);
  writeUInt32(view, 4, entries.length, false);

  const entrySize = use64Bit ? entrySize64 : entrySize32;
  let cursor = HEADER_SIZE;

  layout.forEach((entry) => {
    writeInt32(view, cursor, entry.cpuType, false);
    writeInt32(view, cursor + 4, entry.cpuSubtype, false);

    if (use64Bit) {
      writeUInt64(view, cursor + 8, entry.offset, false);
      writeUInt64(view, cursor + 16, entry.size, false);
      writeUInt32(view, cursor + 24, entry.align, false);
      writeUInt32(view, cursor + 28, 0, false);
    } else {
      writeUInt32(view, cursor + 8, Number(entry.offset), false);
      writeUInt32(view, cursor + 12, Number(entry.size), false);
      writeUInt32(view, cursor + 16, entry.align, false);
    }

    cursor += entrySize;
  });

  layout.forEach((entry) => {
    const destinationOffset = bigIntLengthToNumber(
      entry.offset,
      "architecture offset",
    );
    array.set(entry.data, destinationOffset);
  });

  return createResultBuffer(array);
};



