// Requires polyfill (e.g. react-native-quick-crypto) if Node crypto isn't globally available.
// Most standard RN setups use a polyfill that exposes 'crypto' module.
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

// Runtime check to prevent crashes on non-polyfilled environments
if (typeof createCipheriv !== "function") {
  console.error(
    "EncryptionService: Node crypto polyfill not found. Please install react-native-quick-crypto.",
  );
}

export default class EncryptionService {
  key: Buffer;
  constructor(key: Buffer) {
    this.key = key;
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, data]);
  }

  decrypt(buffer: Buffer): string {
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const data = buffer.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  }
}
