import { ProviderError } from "./errors";

const sealFormat = "v1";
const keyByteLength = 32;
const nonceByteLength = 12;

export class ProviderCredentials {
  #username: string;
  #password: string;

  constructor(username: string, password: string) {
    if (username.length === 0 || username.trim() !== username || password.length === 0) {
      throw new ProviderError("PROVIDER_CREDENTIAL_UNAVAILABLE", null);
    }
    this.#username = username;
    this.#password = password;
  }

  username(): string {
    return this.#username;
  }

  password(): string {
    return this.#password;
  }

  toJSON(): Record<string, never> {
    return {};
  }

  toString(): string {
    return "[ProviderCredentials]";
  }
}

export async function importCredentialKey(secret: string | undefined): Promise<CryptoKey> {
  const bytes = secret ? decodeBase64(secret) : null;
  if (!bytes || bytes.byteLength !== keyByteLength) {
    throw new ProviderError("PROVIDER_CREDENTIAL_UNAVAILABLE", null);
  }
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealCredentials(
  key: CryptoKey,
  credentials: ProviderCredentials
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(nonceByteLength));
  const payload = new TextEncoder().encode(
    JSON.stringify({ username: credentials.username(), password: credentials.password() })
  );
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, payload);
  return `${sealFormat}:${encodeBase64(nonce)}:${encodeBase64(new Uint8Array(ciphertext))}`;
}

export async function unsealCredentials(
  key: CryptoKey,
  sealed: string
): Promise<ProviderCredentials> {
  const parts = sealed.split(":");
  if (parts.length !== 3 || parts[0] !== sealFormat) {
    throw new ProviderError("PROVIDER_CREDENTIAL_UNAVAILABLE", null);
  }
  const nonce = decodeBase64(parts[1] ?? "");
  const ciphertext = decodeBase64(parts[2] ?? "");
  if (
    !nonce ||
    nonce.byteLength !== nonceByteLength ||
    !ciphertext ||
    ciphertext.byteLength === 0
  ) {
    throw new ProviderError("PROVIDER_CREDENTIAL_UNAVAILABLE", null);
  }
  let payload: unknown;
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext);
    payload = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new ProviderError("PROVIDER_CREDENTIAL_UNAVAILABLE", null);
  }
  if (typeof payload !== "object" || payload === null) {
    throw new ProviderError("PROVIDER_CREDENTIAL_UNAVAILABLE", null);
  }
  const { username, password } = payload as { username?: unknown; password?: unknown };
  if (typeof username !== "string" || typeof password !== "string") {
    throw new ProviderError("PROVIDER_CREDENTIAL_UNAVAILABLE", null);
  }
  return new ProviderCredentials(username, password);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
