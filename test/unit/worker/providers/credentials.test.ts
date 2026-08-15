import {
  importCredentialKey,
  ProviderCredentials,
  sealCredentials,
  unsealCredentials
} from "@worker/providers/credentials";
import { ProviderError } from "@worker/providers/errors";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function base64Key(bytes: number): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))));
}

const validSecret = base64Key(32);

describe("provider credential sealing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", () => {
      throw new Error("Network access is forbidden in provider abstraction tests.");
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips credentials through seal and unseal", async () => {
    const key = await importCredentialKey(validSecret);
    const sealed = await sealCredentials(
      key,
      new ProviderCredentials("ops@example.com", "s3cret-pass")
    );
    expect(sealed.startsWith("v1:")).toBe(true);
    const unsealed = await unsealCredentials(key, sealed);
    expect(unsealed.username()).toBe("ops@example.com");
    expect(unsealed.password()).toBe("s3cret-pass");
  });

  it("never stores plaintext in the sealed form", async () => {
    const key = await importCredentialKey(validSecret);
    const sealed = await sealCredentials(
      key,
      new ProviderCredentials("ops@example.com", "hunter2-plaintext")
    );
    expect(sealed).not.toContain("hunter2-plaintext");
    expect(sealed).not.toContain("ops@example.com");
    expect(sealed).not.toContain(btoa("hunter2-plaintext"));
  });

  it("uses a fresh nonce for every seal", async () => {
    const key = await importCredentialKey(validSecret);
    const credentials = new ProviderCredentials("ops@example.com", "same-password");
    const first = await sealCredentials(key, credentials);
    const second = await sealCredentials(key, credentials);
    expect(first).not.toBe(second);
  });

  it("fails closed on tampered ciphertext", async () => {
    const key = await importCredentialKey(validSecret);
    const sealed = await sealCredentials(key, new ProviderCredentials("ops@example.com", "s3cret"));
    const parts = sealed.split(":");
    const body = parts[2] ?? "";
    const tampered = `${parts[0]}:${parts[1]}:${body.slice(0, -2)}${body.endsWith("AA") ? "BB" : "AA"}`;
    await expect(unsealCredentials(key, tampered)).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_UNAVAILABLE"
    });
  });

  it("fails closed with the wrong key", async () => {
    const sealKey = await importCredentialKey(validSecret);
    const otherKey = await importCredentialKey(base64Key(32));
    const sealed = await sealCredentials(
      sealKey,
      new ProviderCredentials("ops@example.com", "s3cret")
    );
    await expect(unsealCredentials(otherKey, sealed)).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_UNAVAILABLE"
    });
  });

  it("fails closed on malformed sealed values", async () => {
    const key = await importCredentialKey(validSecret);
    const malformed = ["", "v1", "v1:", "v1:only-two", "v2:aaaa:bbbb", "v1:%%%:%%%", "plaintext"];
    for (const value of malformed) {
      await expect(unsealCredentials(key, value), JSON.stringify(value)).rejects.toMatchObject({
        code: "PROVIDER_CREDENTIAL_UNAVAILABLE"
      });
    }
  });

  it("fails closed when the credential key secret is missing or malformed", async () => {
    const invalid = [undefined, "", "not-base64!!!", base64Key(16), base64Key(31), base64Key(33)];
    for (const secret of invalid) {
      await expect(
        importCredentialKey(secret),
        JSON.stringify(secret ?? null)
      ).rejects.toMatchObject({ code: "PROVIDER_CREDENTIAL_UNAVAILABLE" });
    }
  });

  it("does not leak credential material through unseal errors", async () => {
    const key = await importCredentialKey(validSecret);
    try {
      await unsealCredentials(key, "v1:aGVsbG8=:cGFzc3dvcmQ9aHVudGVyMg==");
      expect.unreachable();
    } catch (error) {
      const providerError = error as ProviderError;
      expect(providerError).toBeInstanceOf(ProviderError);
      const surfaces = [
        providerError.message,
        providerError.stack ?? "",
        JSON.stringify(providerError, Object.getOwnPropertyNames(providerError))
      ].join("\n");
      expect(surfaces).not.toContain("cGFzc3dvcmQ9aHVudGVyMg");
      expect(surfaces).not.toContain("hunter2");
    }
  });

  it("rejects empty credential fields at construction", () => {
    expect(() => new ProviderCredentials("", "password")).toThrowError(ProviderError);
    expect(() => new ProviderCredentials("user", "")).toThrowError(ProviderError);
    expect(() => new ProviderCredentials(" ", "password")).toThrowError(ProviderError);
  });
});

describe("provider credential redaction", () => {
  it("cannot be serialized, enumerated, or coerced into revealing secrets", () => {
    const credentials = new ProviderCredentials("ops@example.com", "hunter2-secret");
    expect(JSON.stringify(credentials)).toBe("{}");
    expect(JSON.stringify({ credentials })).not.toContain("hunter2-secret");
    expect(String(credentials)).not.toContain("hunter2-secret");
    expect(`${credentials}`).not.toContain("hunter2-secret");
    expect(Object.keys(credentials)).toEqual([]);
    expect(JSON.stringify(Object.entries(credentials))).not.toContain("hunter2-secret");
    expect(JSON.stringify({ ...credentials })).toBe("{}");
  });

  it("still exposes values through explicit accessors only", () => {
    const credentials = new ProviderCredentials("ops@example.com", "hunter2-secret");
    expect(credentials.username()).toBe("ops@example.com");
    expect(credentials.password()).toBe("hunter2-secret");
  });
});
