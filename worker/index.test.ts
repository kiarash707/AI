import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyTask,
  decryptSecret,
  encryptSecret,
  getFreeModels,
  hasZeroTextRequestPrice,
  ownerAuth,
  parseJson,
  safeError,
  taskSuitable,
  zeroPrice,
  type Env,
  type Model,
} from "./index";

const b64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const testEnv = (key = b64(new Uint8Array(32).fill(7))) =>
  ({ AI_CREDENTIALS_ENCRYPTION_KEY: key }) as Env;

afterEach(() => vi.unstubAllGlobals());

describe("request validation", () => {
  it("accepts bounded JSON and rejects wrong content type, malformed JSON, and oversized bodies", async () => {
    await expect(
      parseJson<{ value: string }>(
        new Request("https://kayro.test/api", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: "ok" }),
        }),
      ),
    ).resolves.toEqual({ value: "ok" });

    await expect(
      parseJson(new Request("https://kayro.test/api", { method: "POST", body: "{}" })),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      parseJson(
        new Request("https://kayro.test/api", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{invalid",
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      parseJson(
        new Request("https://kayro.test/api", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: "this is too long" }),
        }),
        8,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});

describe("AI credential encryption", () => {
  it("encrypts with randomized AES-GCM ciphertext and decrypts without exposing plaintext", async () => {
    const env = testEnv();
    const credential = "sk-or-v1-unit-test-secret-not-real";
    const first = await encryptSecret(env, credential);
    const second = await encryptSecret(env, credential);

    expect(first).not.toContain(credential);
    expect(first).toMatch(/^v1\./);
    expect(first).not.toEqual(second);
    await expect(decryptSecret(env, first)).resolves.toBe(credential);
  });

  it("rejects missing, invalid-length, tampered, and wrong-key ciphertext", async () => {
    const credential = "sk-or-v1-test-value";
    await expect(encryptSecret({} as Env, credential)).rejects.toThrow(
      "AI_CREDENTIALS_ENCRYPTION_KEY",
    );
    await expect(
      encryptSecret(testEnv(b64(new Uint8Array(16))), credential),
    ).rejects.toThrow("۳۲ بایت");

    const ciphertext = await encryptSecret(testEnv(), credential);
    const parts = ciphertext.split(".");
    parts[2] = `${parts[2].slice(0, -1)}${parts[2].endsWith("A") ? "B" : "A"}`;
    await expect(decryptSecret(testEnv(), parts.join("."))).rejects.toThrow(
      "بازکردن امن اعتبارنامه",
    );
    await expect(
      decryptSecret(testEnv(b64(new Uint8Array(32).fill(8))), ciphertext),
    ).rejects.toThrow("بازکردن امن اعتبارنامه");
  });
});

describe("OpenRouter price and capability routing", () => {
  it("only treats explicit numeric or string zero as free", () => {
    expect(zeroPrice(0)).toBe(true);
    expect(zeroPrice("0")).toBe(true);
    expect(zeroPrice("0.000000")).toBe(true);
    expect(zeroPrice(undefined)).toBe(false);
    expect(zeroPrice(null)).toBe(false);
    expect(zeroPrice("")).toBe(false);
    expect(zeroPrice("unknown")).toBe(false);
    expect(zeroPrice("0.000001")).toBe(false);
  });

  it("rejects unknown and nonzero request/cache fees", () => {
    expect(hasZeroTextRequestPrice({ prompt: "0", completion: "0" })).toBe(true);
    expect(
      hasZeroTextRequestPrice({ prompt: "0", completion: "0", request: "0.01" }),
    ).toBe(false);
    expect(
      hasZeroTextRequestPrice({
        prompt: "0",
        completion: "0",
        input_cache_read: "0.0001",
      }),
    ).toBe(false);
    expect(hasZeroTextRequestPrice({ prompt: "0", completion: null })).toBe(false);
  });

  it("filters paid and unknown-priced models and exposes only verified metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "free/text",
              name: "Free text",
              context_length: 32000,
              pricing: { prompt: "0", completion: "0" },
              architecture: { input_modalities: ["text"] },
              supported_parameters: ["tools"],
            },
            {
              id: "paid/model",
              pricing: { prompt: "0.0001", completion: "0" },
            },
            {
              id: "unknown/model",
              pricing: { completion: "0" },
            },
            {
              id: "request-fee/model",
              pricing: { prompt: "0", completion: "0", request: "0.001" },
              architecture: { input_modalities: ["text"] },
            },
            {
              id: "unknown-capability/model",
              pricing: { prompt: "0", completion: "0" },
            },
            {
              id: "free/image",
              pricing: { prompt: 0, completion: 0 },
              architecture: { input_modalities: ["text", "image"] },
              supported_parameters: [],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const models = await getFreeModels("test-token");
    expect(models.map((model) => model.id)).toEqual(["free/text", "free/image"]);
    expect(models[0]).toMatchObject({
      input_price: 0,
      output_price: 0,
      modalities: ["text"],
      tools: true,
    });
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: "Bearer test-token",
    });
  });

  it("caches only catalog metadata for a short period and returns defensive copies", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "cached/free-model",
                name: "Cached model",
                context_length: 1000,
                pricing: { prompt: "0", completion: "0" },
                architecture: { input_modalities: ["text"] },
              },
            ],
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const token = `catalog-cache-test-${crypto.randomUUID()}`;
    const first = await getFreeModels(token);
    first[0].modalities.push("poisoned");
    const second = await getFreeModels(token);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second[0].modalities).toEqual(["text"]);
  });

  it("does not leak provider credentials in user-facing errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 401 })),
    );
    await expect(getFreeModels("sk-or-v1-do-not-leak-this")).rejects.toThrow(
      "کلید OpenRouter رد شد",
    );
    expect(safeError(new Error("rejected sk-or-v1-0123456789abcdef"))).not.toContain(
      "0123456789abcdef",
    );
    expect(
      safeError(new Error("bot 1234567:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456")),
    ).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ123456");
  });

  it("routes Persian and English prompts toward relevant free model capabilities", () => {
    expect(classifyTask("کد پایتون رو اصلاح کن")).toBe("coding");
    expect(classifyTask("Compare these design options carefully")).toBe("reasoning");
    expect(classifyTask("سلام، حالت چطوره؟")).toBe("conversation");

    const models: Model[] = [
      {
        id: "general",
        name: "General",
        context_length: 50000,
        input_price: 0,
        output_price: 0,
        image_price: null,
        availability: "available",
        modalities: ["text"],
        tools: false,
        recommended_for: ["conversation"],
      },
      {
        id: "code",
        name: "Code",
        context_length: 32000,
        input_price: 0,
        output_price: 0,
        image_price: null,
        availability: "available",
        modalities: ["text"],
        tools: true,
        recommended_for: ["conversation", "coding"],
      },
      {
        id: "vision",
        name: "Vision",
        context_length: 8000,
        input_price: 0,
        output_price: 0,
        image_price: null,
        availability: "available",
        modalities: ["text", "image"],
        tools: false,
        recommended_for: ["conversation"],
      },
    ];
    expect(taskSuitable(models, "coding")[0].id).toBe("code");
    expect(taskSuitable(models, "image").map((model) => model.id)).toEqual(["vision"]);
  });
});

const base64Url = (value: string | ArrayBuffer) => {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

describe("owner authorization defaults", () => {
  it("fails closed when production Access configuration is absent", async () => {
    const result = await ownerAuth(
      new Request("https://kayro.example/api/ai/settings"),
      {} as Env,
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("validates the Access JWT signature and owner email", async () => {
    const pair = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    const publicJwk = (await crypto.subtle.exportKey(
      "jwk",
      pair.publicKey,
    )) as JsonWebKey & { kid: string };
    publicJwk.kid = "unit-test-key";
    const claims = {
      iss: "https://team.example.com",
      aud: ["kayro-test-audience"],
      exp: Math.floor(Date.now() / 1000) + 300,
      email: "owner@example.com",
    };
    const protectedHeader = base64Url(
      JSON.stringify({ alg: "RS256", kid: publicJwk.kid }),
    );
    const encodedClaims = base64Url(JSON.stringify(claims));
    const signingInput = `${protectedHeader}.${encodedClaims}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(signingInput),
    );
    const token = `${signingInput}.${base64Url(signature)}`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ keys: [publicJwk] }), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const request = new Request("https://kayro.example/api/ai/settings", {
      headers: { "Cf-Access-Jwt-Assertion": token },
    });
    const env = {
      ACCESS_TEAM_DOMAIN: "team.example.com",
      ACCESS_AUD: "kayro-test-audience",
      KAYRO_OWNER_EMAIL: "owner@example.com",
    } as Env;

    await expect(ownerAuth(request, env)).resolves.toMatchObject({ ok: true });
    await expect(
      ownerAuth(request, { ...env, KAYRO_OWNER_EMAIL: "other@example.com" }),
    ).resolves.toMatchObject({ ok: false, status: 403 });
    const tampered = new Request(request.url, {
      headers: {
        "Cf-Access-Jwt-Assertion": `${signingInput}.${"A".repeat(342)}`,
      },
    });
    await expect(ownerAuth(tampered, env)).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("only bypasses auth when local dev mode is explicitly enabled", async () => {
    const result = await ownerAuth(new Request("http://localhost/api/ai/settings"), {
      DEV_MODE: "true",
    } as Env);
    expect(result).toMatchObject({ ok: true, status: 200 });
  });
});
