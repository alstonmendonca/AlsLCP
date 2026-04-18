const HASH_PREFIX = "pbkdf2";
const HASH_ALGO = "SHA-256";
const HASH_ITERATIONS = 210_000;
const HASH_BYTES = 32;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function safeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function derive(secret: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: HASH_ALGO,
      salt,
      iterations,
    },
    keyMaterial,
    HASH_BYTES * 8,
  );

  return new Uint8Array(bits);
}

export async function hashSecret(secret: string): Promise<string> {
  const clean = String(secret || "");
  if (!clean) throw new Error("Secret is required");

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derive(clean, salt, HASH_ITERATIONS);
  return `${HASH_PREFIX}$${HASH_ALGO}$${HASH_ITERATIONS}$${toBase64(salt)}$${toBase64(digest)}`;
}

export async function verifySecret(secret: string, storedHash: string): Promise<boolean> {
  const clean = String(secret || "");
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 5) return false;

  const [prefix, algo, iterRaw, saltB64, hashB64] = parts;
  if (prefix !== HASH_PREFIX || algo !== HASH_ALGO) return false;

  const iterations = Number(iterRaw);
  if (!Number.isFinite(iterations) || iterations < 50_000) return false;

  const salt = fromBase64(saltB64);
  const expected = fromBase64(hashB64);
  const actual = await derive(clean, salt, iterations);
  return safeEqual(actual, expected);
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(String(pin || ""));
}

export function isValidActivationKey(keyCode: string): boolean {
  return /^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/.test(String(keyCode || "").trim().toUpperCase());
}
