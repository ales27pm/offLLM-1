import CryptoJS from "crypto-js";
import { kyber } from "noble-post-quantum";

let sharedSecret;
let keyPair;

export async function initCrypto() {
  try {
    keyPair = await kyber.keypair();
    const capsule = await kyber.encapsulate(keyPair.publicKey);
    sharedSecret = await kyber.decapsulate(capsule, keyPair.privateKey);

    return true;
  } catch (error) {
    console.error("Failed to initialize quantum-safe cryptography:", error);

    // Fallback to traditional encryption
    sharedSecret = CryptoJS.lib.WordArray.random(32);
    return false;
  }
}

export async function encrypt(plaintext) {
  if (!sharedSecret) {
    await initCrypto();
  }

  try {
    // Use Kyber for quantum-safe encryption if available
    if (keyPair && sharedSecret) {
      const capsule = await kyber.encapsulate(keyPair.publicKey);
      const encrypted = await _encryptWithKyber(plaintext, sharedSecret);

      return JSON.stringify({
        capsule: Array.from(capsule),
        encrypted: Array.from(encrypted),
        algorithm: "kyber",
      });
    } else {
      // Fallback to AES encryption
      const encrypted = CryptoJS.AES.encrypt(
        plaintext,
        sharedSecret.toString(),
      ).toString();

      return JSON.stringify({
        encrypted,
        algorithm: "aes",
      });
    }
  } catch (error) {
    console.error("Encryption failed:", error);
    throw new Error("Failed to encrypt data");
  }
}

export async function decrypt(ciphertext) {
  if (!sharedSecret) {
    await initCrypto();
  }

  try {
    const data = JSON.parse(ciphertext);

    if (data.algorithm === "kyber") {
      const capsule = new Uint8Array(data.capsule);
      const encrypted = new Uint8Array(data.encrypted);

      const secret = await kyber.decapsulate(capsule, keyPair.privateKey);
      return await _decryptWithKyber(encrypted, secret);
    } else {
      // AES decryption
      const bytes = CryptoJS.AES.decrypt(
        data.encrypted,
        sharedSecret.toString(),
      );
      return bytes.toString(CryptoJS.enc.Utf8);
    }
  } catch (error) {
    console.error("Decryption failed:", error);
    throw new Error("Failed to decrypt data");
  }
}

async function _encryptWithKyber(plaintext, secret) {
  // Convert plaintext to bytes
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  if (!(secret instanceof Uint8Array)) {
    secret = new Uint8Array(secret);
  }

  // Use the first 32 bytes of the secret as AES key
  const aesKey = secret.slice(0, 32);
  const aesKeyWordArray = _uint8ArrayToWordArray(aesKey);

  // Generate a random IV
  const iv = CryptoJS.lib.WordArray.random(16);

  // Encrypt with AES-CBC (CryptoJS doesn't support GCM natively)
  const encrypted = CryptoJS.AES.encrypt(
    _uint8ArrayToWordArray(plaintextBytes),
    aesKeyWordArray,
    { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 },
  );

  // Combine IV and ciphertext safely
  const ivBytes = _wordArrayToUint8Array(iv);
  const cipherBytes = _wordArrayToUint8Array(encrypted.ciphertext);
  const result = new Uint8Array(ivBytes.length + cipherBytes.length);
  result.set(ivBytes, 0);
  result.set(cipherBytes, ivBytes.length);

  return result;
}

async function _decryptWithKyber(encrypted, secret) {
  try {
    if (!(secret instanceof Uint8Array)) {
      secret = new Uint8Array(secret);
    }

    // Use the first 32 bytes of the secret as AES key
    const aesKey = secret.slice(0, 32);
    const aesKeyWordArray = _uint8ArrayToWordArray(aesKey);

    // Extract IV and ciphertext
    const iv = encrypted.slice(0, 16);
    const ciphertext = encrypted.slice(16);

    // Decrypt with AES-CBC
    const decrypted = CryptoJS.AES.decrypt(
      { ciphertext: _uint8ArrayToWordArray(ciphertext) },
      aesKeyWordArray,
      {
        iv: _uint8ArrayToWordArray(iv),
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
      },
    );

    // Convert back to string
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error("Kyber decryption failed:", error);
    throw new Error("Failed to decrypt with Kyber");
  }
}

function _wordArrayToUint8Array(wordArray) {
  const { words, sigBytes } = wordArray;
  const result = new Uint8Array(sigBytes);
  // CryptoJS stores words in big-endian format; extract bytes explicitly to
  // avoid host endianness issues.
  for (let i = 0; i < sigBytes; i++) {
    result[i] = (words[i >>> 2] >>> (24 - (i & 3) * 8)) & 0xff;
  }
  return result;
}

function _uint8ArrayToWordArray(u8Array) {
  const words = new Array(Math.ceil(u8Array.length / 4)).fill(0);
  for (let i = 0; i < u8Array.length; i++) {
    words[i >>> 2] |= u8Array[i] << (24 - (i & 3) * 8);
  }
  return CryptoJS.lib.WordArray.create(words, u8Array.length);
}

export async function rotateKeys() {
  try {
    const newKeyPair = await kyber.keypair();
    const capsule = await kyber.encapsulate(newKeyPair.publicKey);
    sharedSecret = await kyber.decapsulate(capsule, newKeyPair.privateKey);
    keyPair = newKeyPair;

    return true;
  } catch (error) {
    console.error("Failed to rotate keys:", error);
    return false;
  }
}

export async function generateHash(data, algorithm = "SHA3-256") {
  try {
    switch (algorithm) {
      case "SHA3-256":
        return CryptoJS.SHA3(data, { outputLength: 256 }).toString();
      case "SHA3-512":
        return CryptoJS.SHA3(data, { outputLength: 512 }).toString();
      case "SHA256":
        return CryptoJS.SHA256(data).toString();
      default:
        return CryptoJS.SHA3(data, { outputLength: 256 }).toString();
    }
  } catch (error) {
    console.error("Hash generation failed:", error);
    throw new Error("Failed to generate hash");
  }
}

export async function generateSignature(data, privateKey) {
  try {
    // In a real implementation, this would use a quantum-safe signature algorithm
    // For now, we use HMAC with SHA3 as a placeholder
    return CryptoJS.HmacSHA3(data, privateKey).toString();
  } catch (error) {
    console.error("Signature generation failed:", error);
    throw new Error("Failed to generate signature");
  }
}

export async function verifySignature(data, signature, publicKey) {
  try {
    // In a real implementation, this would verify a quantum-safe signature
    // For now, we use HMAC with SHA3 as a placeholder
    const expectedSignature = CryptoJS.HmacSHA3(data, publicKey).toString();
    return expectedSignature === signature;
  } catch (error) {
    console.error("Signature verification failed:", error);
    return false;
  }
}



