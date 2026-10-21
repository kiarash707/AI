export interface Env {
  DB: D1Database;
  AI_CREDENTIALS_ENCRYPTION_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  ALLOWED_ORIGIN?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  KAYRO_OWNER_EMAIL?: string;
  DEV_MODE?: string;
}
export type Model = {
  id: string;
  name: string;
  context_length: number;
  input_price: number;
  output_price: number;
  modalities: string[];
  tools: boolean;
  recommended_for: string[];
  availability: "available";
  image_price: number | null;
};
let modelCache: {
  fingerprint: string;
  expiresAt: number;
  models: Model[];
} | null = null;
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
const responseHeaders = (origin: string) => ({
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers":
    "content-type,authorization,x-telegram-bot-api-secret-token",
  vary: "Origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "cache-control": "no-store",
});
const json = (data: unknown, status = 200, origin = "*") =>
  new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(origin),
  });
const fail = (message: string, status = 400, origin = "*") =>
  json({ error: message }, status, origin);
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function parseJson<T>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json"))
    throw new ApiError("درخواست باید با قالب JSON ارسال شود.", 415);
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > maxBytes)
    throw new ApiError("حجم درخواست بیش از حد مجاز است.", 413);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes)
    throw new ApiError("حجم درخواست بیش از حد مجاز است.", 413);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new ApiError("بدنهٔ JSON معتبر نیست.", 400);
  }
}
export const safeError = (e: unknown) => {
  const s = String(e instanceof Error ? e.message : e);
  return s
    .replace(/(?:sk-or-v1-|sk-)[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/\b\d{7,}:[A-Za-z0-9_-]{20,}\b/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?/g,
      "[redacted]",
    )
    .slice(0, 350);
};
async function ensure(db: D1Database) {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'web', created_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS messages_conv_created ON messages(conversation_id,created_at)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS telegram_links (telegram_user_id TEXT PRIMARY KEY, active_conversation_id TEXT, updated_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS telegram_updates (update_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, conversation_id TEXT, owner_id TEXT NOT NULL, status TEXT NOT NULL, input TEXT NOT NULL, output TEXT, step TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS model_events (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, requested_model TEXT, used_model TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL)",
    ),
  ]);
}
async function rateLimited(db: D1Database, key: string, limit = 6) {
  const t = Math.floor(Date.now() / 60000),
    row: any = await db
      .prepare("SELECT window_start,count FROM rate_limits WHERE key=?")
      .bind(key)
      .first();
  if (row && row.window_start === t && row.count >= limit) return true;
  await db
    .prepare(
      "INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,count=CASE WHEN rate_limits.window_start=excluded.window_start THEN rate_limits.count+1 ELSE 1 END",
    )
    .bind(key, t)
    .run();
  return false;
}
async function setting(db: D1Database, key: string) {
  const r: any = await db
    .prepare("SELECT value FROM settings WHERE key=?")
    .bind(key)
    .first();
  return typeof r?.value === "string" ? r.value : null;
}
function fromB64(s: string) {
  const clean = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(
    atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, "=")),
    (c) => c.charCodeAt(0),
  );
}
function toB64(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function fingerprintKey(value: string) {
  return toB64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
  );
}
async function encryptionKey(env: Env) {
  if (!env.AI_CREDENTIALS_ENCRYPTION_KEY)
    throw new Error(
      "سرور هنوز Secret با نام AI_CREDENTIALS_ENCRYPTION_KEY را تنظیم نکرده است.",
    );
  let raw: Uint8Array;
  try {
    raw = fromB64(env.AI_CREDENTIALS_ENCRYPTION_KEY);
  } catch {
    throw new Error(
      "کلید رمزنگاری سمت سرور معتبر نیست؛ مقدار Base64 با ۳۲ بایت تصادفی لازم است.",
    );
  }
  if (raw.byteLength !== 32)
    throw new Error("Secret رمزنگاری باید Base64 از ۳۲ بایت تصادفی باشد.");
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptSecret(env: Env, value: string) {
  const key = await encryptionKey(env),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: encoder.encode("kayro-ai/openrouter/v1"),
        },
        key,
        encoder.encode(value),
      ),
    );
  return `v1.${toB64(iv)}.${toB64(cipher)}`;
}
export async function decryptSecret(env: Env, stored: string) {
  const parts = stored.split(".");
  if (parts.length !== 3 || parts[0] !== "v1")
    throw new Error("اعتبارنامهٔ ذخیره‌شده قابل‌خواندن نیست.");
  const key = await encryptionKey(env);
  try {
    return decoder.decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: fromB64(parts[1]),
          additionalData: encoder.encode("kayro-ai/openrouter/v1"),
        },
        key,
        fromB64(parts[2]),
      ),
    );
  } catch {
    throw new Error("بازکردن امن اعتبارنامه ممکن نشد؛ Secret رمزنگاری را بررسی کنید.");
  }
}
export async function ownerAuth(
  req: Request,
  env: Env,
): Promise<{ ok: boolean; status: number; message: string }> {
  if (env.DEV_MODE === "true") return { ok: true, status: 200, message: "" };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !env.KAYRO_OWNER_EMAIL)
    return {
      ok: false,
      status: 503,
      message:
        "احراز هویت مالک پیکربندی نشده است؛ Cloudflare Access و ایمیل مالک را تنظیم کنید.",
    };
  const jwt = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt)
    return {
      ok: false,
      status: 401,
      message: "برای دسترسی به این بخش باید از درگاه امن Cloudflare Access وارد شوید.",
    };
  try {
    if (jwt.length > 8192) throw Error("jwt-size");
    const [h, p, s] = jwt.split(".");
    if (!h || !p || !s) throw Error();
    const head = JSON.parse(decoder.decode(fromB64(h))),
      claims = JSON.parse(decoder.decode(fromB64(p)));
    if (head.alg !== "RS256" || typeof head.kid !== "string")
      return {
        ok: false,
        status: 401,
        message: "الگوریتم یا شناسهٔ کلید توکن دسترسی نامعتبر است.",
      };
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
    if (
      claims.iss !== issuer ||
      !(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(
        env.ACCESS_AUD,
      ) ||
      typeof claims.exp !== "number" ||
      claims.exp < Date.now() / 1000 ||
      (typeof claims.nbf === "number" && claims.nbf > Date.now() / 1000) ||
      typeof claims.email !== "string"
    )
      return {
        ok: false,
        status: 401,
        message: "نشست Cloudflare Access معتبر یا فعال نیست.",
      };
    const certResponse = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!certResponse.ok) throw Error("certs");
    const certs: any = await certResponse.json(),
      jwk = certs.keys?.find((x: any) => x.kid === head.kid);
    if (!jwk) throw Error("kid");
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      fromB64(s),
      encoder.encode(`${h}.${p}`),
    );
    if (!valid)
      return {
        ok: false,
        status: 401,
        message: "توکن دسترسی امضای معتبر ندارد.",
      };
    if (claims.email.toLowerCase() !== env.KAYRO_OWNER_EMAIL.toLowerCase())
      return {
        ok: false,
        status: 403,
        message: "تنظیمات هوش مصنوعی فقط برای مالک سایت فعال است.",
      };
    return { ok: true, status: 200, message: "" };
  } catch {
    return {
      ok: false,
      status: 401,
      message: "تأیید هویت امن ناموفق شد؛ نشست Cloudflare Access را تازه کنید.",
    };
  }
}
async function openRouterKey(db: D1Database, env: Env) {
  const encrypted = await setting(db, "ai_openrouter_encrypted");
  return encrypted ? decryptSecret(env, encrypted) : null;
}
export function zeroPrice(x: unknown) {
  if (typeof x !== "string" && typeof x !== "number") return false;
  if (x === "" || x === null) return false;
  const n = Number(x);
  return Number.isFinite(n) && n === 0;
}
export function hasZeroTextRequestPrice(pricing: any) {
  if (!zeroPrice(pricing?.prompt) || !zeroPrice(pricing?.completion)) return false;
  for (const cost of ["request", "input_cache_read", "input_cache_write"]) {
    if (cost in (pricing || {}) && !zeroPrice(pricing[cost])) return false;
  }
  return true;
}
export async function getFreeModels(key: string): Promise<Model[]> {
  const keyFingerprint = await fingerprintKey(key);
  if (modelCache?.fingerprint === keyFingerprint && modelCache.expiresAt > Date.now())
    return modelCache.models.map((model) => ({
      ...model,
      modalities: [...model.modalities],
      recommended_for: [...model.recommended_for],
    }));
  const r = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://kayro.ai",
      "X-Title": "KAYRO AI",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403)
      throw new Error("کلید OpenRouter رد شد؛ کلید را بررسی یا جایگزین کنید.");
    if (r.status === 429)
      throw new Error(
        "محدودیت نرخ OpenRouter هنگام دریافت مدل‌ها؛ چند دقیقه بعد دوباره تلاش کنید.",
      );
    throw new Error(`دریافت مدل‌ها ناموفق بود (HTTP ${r.status}).`);
  }
  const data: any = await r.json();
  const models: Model[] = (data.data || [])
    .filter((m: any) => {
      const modalities = m?.architecture?.input_modalities;
      return (
        hasZeroTextRequestPrice(m?.pricing) &&
        Array.isArray(modalities) &&
        modalities.includes("text")
      );
    })
    .map((m: any) => {
      const modalities: string[] = m.architecture.input_modalities.filter(
        (value: unknown): value is string =>
          typeof value === "string" && ["text", "image"].includes(value),
      );
      const supportsTools = Boolean(
        m.supported_parameters?.includes("tools") ||
        m.supported_parameters?.includes("tool_choice"),
      );
      const identity = `${m.id} ${m.name || ""}`;
      return {
        id: String(m.id),
        name: String(m.name || m.id),
        context_length: Number(m.context_length || 0),
        input_price: 0,
        output_price: 0,
        image_price:
          m.pricing?.image === undefined || !Number.isFinite(Number(m.pricing.image))
            ? null
            : Number(m.pricing.image),
        modalities,
        tools: supportsTools,
        availability: "available" as const,
        recommended_for: [
          "conversation",
          ...(/code|coder|program/i.test(identity) ? ["coding"] : []),
          ...(supportsTools ? ["reasoning"] : []),
        ],
      };
    });
  modelCache = {
    fingerprint: keyFingerprint,
    expiresAt: Date.now() + 5 * 60 * 1000,
    models,
  };
  return models.map((model) => ({
    ...model,
    modalities: [...model.modalities],
    recommended_for: [...model.recommended_for],
  }));
}
export function classifyTask(text: string) {
  if (
    /```|\b(code|coding|program|debug|typescript|javascript|python|sql)\b|کد|برنامه[\s‌]?نویسی|خطایابی/i.test(
      text,
    )
  )
    return "coding";
  if (
    /\b(analy[sz]e|reason|compare|plan|architecture|strategy)\b|استدلال|مقایسه|تحلیل|برنامه[\s‌]?ریزی/i.test(
      text,
    )
  )
    return "reasoning";
  return "conversation";
}
export function taskSuitable(models: Model[], task: string) {
  const filtered =
    task === "image"
      ? models.filter((m) => m.modalities.includes("image"))
      : models.filter((m) => m.modalities.includes("text"));
  if (task === "coding")
    return filtered.sort(
      (a, b) =>
        Number(b.recommended_for.includes("coding")) -
          Number(a.recommended_for.includes("coding")) ||
        b.context_length - a.context_length,
    );
  if (task === "reasoning")
    return filtered.sort(
      (a, b) =>
        Number(b.tools) - Number(a.tools) || b.context_length - a.context_length,
    );
  return filtered.sort((a, b) => b.context_length - a.context_length);
}
function friendlyProviderError(status: number, _body: any) {
  if (status === 401 || status === 403)
    return "OpenRouter کلید را نپذیرفت. کلید API را بررسی کنید.";
  if (status === 429)
    return "محدودیت نرخ مدل رایگان پر شده است. سیستم فقط مدل رایگان دیگری را امتحان می‌کند؛ در صورت نبود ظرفیت، بعداً ادامه دهید.";
  if (status === 408 || status === 504)
    return "پاسخ مدل دیر رسید؛ یک مدل رایگان دیگر به‌صورت محدود امتحان می‌شود.";
  if (status >= 500)
    return "سرویس مدل موقتاً خطا داد؛ تلاش محدود برای مدل رایگان جایگزین انجام می‌شود.";
  return `درخواست مدل پذیرفته نشد (HTTP ${status}). جزئیات فنی و اعتبارنامه در پاسخ مرورگر نمایش داده نمی‌شوند.`;
}
async function answer(
  db: D1Database,
  env: Env,
  conversationId: string,
  userText: string,
  source: "web" | "telegram",
  requestedModel?: string,
) {
  const secret = await openRouterKey(db, env);
  if (!secret)
    throw Object.assign(
      Error(
        "کلید هوش مصنوعی تنظیم نشده است. از تنظیمات ← هوش مصنوعی و API کلید را اضافه و اتصال را آزمایش کنید.",
      ),
      { status: 503 },
    );
  const all = await getFreeModels(secret);
  if (!all.length)
    throw Object.assign(
      Error(
        "مدل رایگان با هزینهٔ صفرِ تأییدشده پیدا نشد؛ پیام ذخیره شد و گفتگو برای ادامه حفظ شده است.",
      ),
      { status: 503 },
    );
  const selected = taskSuitable(all, classifyTask(userText)),
    preferred = requestedModel && selected.find((m) => m.id === requestedModel);
  if (preferred)
    (selected.splice(selected.indexOf(preferred), 1), selected.unshift(preferred));
  const initialModel = selected[0]?.id;
  const history: any = await db
    .prepare(
      "SELECT role,content FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT 21",
    )
    .bind(conversationId)
    .all();
  const messages = [...(history.results || [])]
    .reverse()
    .map((m: any) => ({ role: m.role, content: m.content }));
  let lastError = "";
  for (const model of selected.slice(0, 3)) {
    let response: Response;
    try {
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://kayro.ai",
          "X-Title": "KAYRO AI",
        },
        body: JSON.stringify({
          model: model.id,
          messages,
          stream: false,
          max_tokens: 1200,
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      lastError =
        e instanceof DOMException && e.name === "TimeoutError"
          ? "مهلت پاسخ مدل تمام شد."
          : "ارتباط با سرویس مدل برقرار نشد.";
      continue;
    }
    let data: any = {};
    try {
      data = await response.json();
    } catch {}
    if (!response.ok) {
      lastError = friendlyProviderError(response.status, data);
      if ([400, 401, 402, 403].includes(response.status)) break;
      continue;
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      lastError = "مدل پاسخ متنی معتبری برنگرداند.";
      continue;
    }
    const stamp = now();
    await db
      .prepare(
        "INSERT INTO messages(id,conversation_id,role,content,source,created_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(uuid(), conversationId, "assistant", content, source, stamp)
      .run();
    await db
      .prepare("UPDATE conversations SET updated_at=? WHERE id=?")
      .bind(stamp, conversationId)
      .run();
    const switched = Boolean(initialModel && model.id !== initialModel);
    if (switched)
      await db
        .prepare(
          "INSERT INTO model_events(id,conversation_id,requested_model,used_model,reason,created_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          uuid(),
          conversationId,
          requestedModel || initialModel,
          model.id,
          lastError || "مدل قبلی در دسترس نبود؛ مدل رایگان بعدی استفاده شد.",
          stamp,
        )
        .run();
    return {
      reply: content,
      model: model.id,
      switched,
      reason: switched ? lastError || "به مدل رایگان جایگزین منتقل شد." : undefined,
    };
  }
  throw Object.assign(
    Error(
      lastError ||
        "هیچ مدل رایگان در دسترس نیست. گفتگو ذخیره شده و می‌توانید بعداً ادامه دهید.",
    ),
    { status: 503 },
  );
}
async function tg(env: Env, method: string, body: unknown) {
  if (!env.TELEGRAM_BOT_TOKEN) throw Error("اتصال ربات تلگرام پیکربندی نشده است.");
  const r = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    },
  );
  const d: any = await r.json();
  if (!r.ok || !d.ok) throw Error("درخواست ربات تلگرام ناموفق بود.");
  return d.result;
}
async function handleTelegram(req: Request, env: Env) {
  if (
    !env.TELEGRAM_WEBHOOK_SECRET ||
    req.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET
  )
    return fail("Unauthorized", 401);
  try {
    await ensure(env.DB);
    const update: any = await parseJson(req, 1024 * 1024),
      result = await env.DB.prepare(
        "INSERT OR IGNORE INTO telegram_updates(update_id,created_at) VALUES(?,?)",
      )
        .bind(update.update_id, now())
        .run();
    if (!result.meta.changes) return json({ ok: true, duplicate: true });
    const callback = update.callback_query;
    if (callback?.from?.id) {
      const uid = String(callback.from.id),
        owner = await setting(env.DB, "owner_telegram_user_id"),
        match = String(callback.data || "").match(/^open:([0-9a-f-]{36})$/i);
      if (!owner || uid !== owner || !match) {
        await tg(env, "answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "دسترسی یا گفتگو معتبر نیست.",
        });
        return json({ ok: true });
      }
      const conversation: any = await env.DB.prepare(
        "SELECT id,title FROM conversations WHERE id=? AND owner_id='owner' AND archived=0",
      )
        .bind(match[1])
        .first();
      if (!conversation) {
        await tg(env, "answerCallbackQuery", {
          callback_query_id: callback.id,
          text: "گفتگو پیدا نشد.",
        });
        return json({ ok: true });
      }
      await env.DB.prepare(
        "INSERT OR REPLACE INTO telegram_links(telegram_user_id,active_conversation_id,updated_at) VALUES(?,?,?)",
      )
        .bind(uid, conversation.id, now())
        .run();
      await tg(env, "answerCallbackQuery", {
        callback_query_id: callback.id,
        text: "گفتگو باز شد.",
      });
      await tg(env, "sendMessage", {
        chat_id: callback.message?.chat?.id,
        text: `گفتگوی فعال: ${conversation.title}\nپیام‌تان را بفرستید تا از همین مکالمه ادامه دهیم.`,
      });
      return json({ ok: true });
    }
    const msg = update.message;
    if (!msg?.from?.id) return json({ ok: true });
    const uid = String(msg.from.id),
      text = String(msg.text || ""),
      owner = await setting(env.DB, "owner_telegram_user_id");
    if (!owner || uid !== owner) {
      await tg(env, "sendMessage", {
        chat_id: msg.chat.id,
        text: "این ربات برای این حساب مجاز نشده است.",
      });
      return json({ ok: true });
    }
    const active: any = await env.DB.prepare(
      "SELECT active_conversation_id FROM telegram_links WHERE telegram_user_id=?",
    )
      .bind(uid)
      .first();
    if (text.startsWith("/start")) {
      await tg(env, "sendMessage", {
        chat_id: msg.chat.id,
        text: "ربات KAYRO آماده است. /chats برای گفتگوهای قبلی و /new برای گفتگوی تازه.",
      });
    } else if (text.startsWith("/new")) {
      const cid = uuid(),
        stamp = now();
      await env.DB.prepare(
        "INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)",
      )
        .bind(cid, "owner", "گفتگوی تلگرام", stamp, stamp)
        .run();
      await env.DB.prepare(
        "INSERT OR REPLACE INTO telegram_links(telegram_user_id,active_conversation_id,updated_at) VALUES(?,?,?)",
      )
        .bind(uid, cid, stamp)
        .run();
      await tg(env, "sendMessage", {
        chat_id: msg.chat.id,
        text: "گفتگوی تازه ساخته شد. پیام‌تان را ارسال کنید.",
      });
    } else if (text.startsWith("/chats")) {
      const list: any = await env.DB.prepare(
        "SELECT id,title,updated_at FROM conversations WHERE owner_id=? AND archived=0 ORDER BY updated_at DESC LIMIT 8",
      )
        .bind("owner")
        .all();
      const buttons = (list.results || []).map((c: any) => [
        { text: String(c.title).slice(0, 45), callback_data: `open:${c.id}` },
      ]);
      await tg(env, "sendMessage", {
        chat_id: msg.chat.id,
        text: buttons.length ? "گفتگوهای ذخیره‌شده:" : "گفتگویی پیدا نشد.",
        reply_markup: { inline_keyboard: buttons },
      });
    } else if (active?.active_conversation_id && text && !text.startsWith("/")) {
      const cid = active.active_conversation_id,
        conversation: any = await env.DB.prepare(
          "SELECT id FROM conversations WHERE id=? AND owner_id=? AND archived=0",
        )
          .bind(cid, "owner")
          .first();
      if (!conversation) {
        await tg(env, "sendMessage", {
          chat_id: msg.chat.id,
          text: "گفتگوی فعال معتبر نیست؛ /chats را بزنید.",
        });
      } else if (await rateLimited(env.DB, "ai-chat-owner", 30)) {
        await tg(env, "sendMessage", {
          chat_id: msg.chat.id,
          text: "درخواست‌های زیادی ارسال شده است؛ یک دقیقه بعد دوباره تلاش کنید.",
        });
      } else {
        const stamp = now();
        await env.DB.prepare(
          "INSERT INTO messages(id,conversation_id,role,content,source,created_at) VALUES(?,?,?,?,?,?)",
        )
          .bind(uuid(), cid, "user", text, "telegram", stamp)
          .run();
        await env.DB.prepare("UPDATE conversations SET updated_at=? WHERE id=?")
          .bind(stamp, cid)
          .run();
        try {
          const preferred =
            (await setting(env.DB, "ai_model_mode")) === "manual"
              ? await setting(env.DB, "ai_default_model")
              : undefined;
          const result = await answer(
            env.DB,
            env,
            cid,
            text,
            "telegram",
            preferred || undefined,
          );
          await tg(env, "sendMessage", {
            chat_id: msg.chat.id,
            text: result.reply.slice(0, 4000),
          });
        } catch (e) {
          await tg(env, "sendMessage", {
            chat_id: msg.chat.id,
            text: safeError(e).slice(0, 800),
          });
        }
      }
    } else
      await tg(env, "sendMessage", {
        chat_id: msg.chat.id,
        text: "برای شروع /new یا مشاهدهٔ گفتگوها /chats را بزنید.",
      });
    return json({ ok: true });
  } catch (e) {
    return fail(safeError(e), e instanceof ApiError ? e.status : 500);
  }
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url),
      origin = req.headers.get("Origin") || "*";
    if (req.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: responseHeaders(origin),
      });
    if (origin !== "*" && env.ALLOWED_ORIGIN && origin !== env.ALLOWED_ORIGIN)
      return fail("Origin not allowed", 403, origin);
    if (url.pathname === "/api/health" && req.method === "GET")
      return json({ ok: true });
    if (url.pathname === "/api/telegram/webhook" && req.method === "POST")
      return handleTelegram(req, env);
    if (!url.pathname.startsWith("/api/"))
      return new Response("KAYRO AI", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    const auth = await ownerAuth(req, env);
    if (!auth.ok) return fail(auth.message, auth.status, origin);
    try {
      await ensure(env.DB);
      if (url.pathname === "/api/ai/settings" && req.method === "GET") {
        const stored = await setting(env.DB, "ai_openrouter_encrypted"),
          selected = await setting(env.DB, "ai_default_model"),
          mode = (await setting(env.DB, "ai_model_mode")) || "auto",
          last = await setting(env.DB, "ai_last_tested_at");
        let mask = "";
        let verifiedLastTest: string | null = null;
        if (stored) {
          try {
            const credential = await decryptSecret(env, stored);
            mask = `••••••••${credential.slice(-4)}`;
            const testedFingerprint = await setting(
              env.DB,
              "ai_tested_key_fingerprint",
            );
            if (
              last &&
              testedFingerprint &&
              testedFingerprint === (await fingerprintKey(credential))
            ) {
              verifiedLastTest = last;
            }
          } catch {
            mask = "ذخیره‌شده؛ رمزگشایی نیازمند بررسی سرور";
          }
        }
        return json(
          {
            provider: "openrouter",
            has_key: Boolean(stored),
            masked_key: mask,
            default_model: selected,
            model_mode: mode,
            last_tested_at: verifiedLastTest,
          },
          200,
          origin,
        );
      }
      if (url.pathname === "/api/ai/test" && req.method === "POST") {
        if (await rateLimited(env.DB, "ai-test-owner", 6))
          return fail(
            "تعداد آزمایش‌ها زیاد است؛ یک دقیقه بعد دوباره تلاش کنید.",
            429,
            origin,
          );
        const body: any = await parseJson(req);
        const key =
          typeof body.api_key === "string" && body.api_key.trim()
            ? body.api_key.trim()
            : await openRouterKey(env.DB, env);
        if (!key) return fail("ابتدا کلید OpenRouter را وارد کنید.", 422, origin);
        if (key.length > 512 || /[\r\n]/.test(key))
          return fail("قالب کلید نامعتبر است.", 422, origin);
        try {
          const models = await getFreeModels(key);
          const tested = now(),
            fingerprint = await fingerprintKey(key);
          await env.DB.prepare(
            "INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)",
          )
            .bind("ai_last_tested_at", tested, tested)
            .run();
          await env.DB.prepare(
            "INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)",
          )
            .bind("ai_tested_key_fingerprint", fingerprint, tested)
            .run();
          return json(
            { ok: true, free_model_count: models.length, tested_at: tested },
            200,
            origin,
          );
        } catch (e) {
          return fail(
            safeError(e),
            e instanceof Error && e.message.includes("رد شد") ? 401 : 502,
            origin,
          );
        }
      }
      if (url.pathname === "/api/ai/settings" && req.method === "PUT") {
        const body: any = await parseJson(req);
        if (body.provider !== "openrouter")
          return fail(
            "ارائه‌دهندهٔ پشتیبانی‌شده در حال حاضر OpenRouter است.",
            422,
            origin,
          );
        const secret = typeof body.api_key === "string" ? body.api_key.trim() : "";
        if (
          secret &&
          (secret.length < 8 || secret.length > 512 || /[\r\n]/.test(secret))
        )
          return fail("قالب کلید API معتبر نیست.", 422, origin);
        const encrypted = secret ? await encryptSecret(env, secret) : null;
        const mode = body.model_mode === "manual" ? "manual" : "auto";
        let chosen = "";
        if (mode === "manual") {
          if (typeof body.default_model !== "string" || body.default_model.length > 240)
            return fail("یک مدل معتبر انتخاب کنید.", 422, origin);
          const key = secret || (await openRouterKey(env.DB, env));
          if (!key)
            return fail("برای انتخاب مدل ابتدا کلید را ذخیره کنید.", 422, origin);
          const models = await getFreeModels(key);
          if (!models.some((m) => m.id === body.default_model))
            return fail(
              "مدل انتخابی در فهرست مدل‌های رایگان با قیمت صفر نیست.",
              422,
              origin,
            );
          chosen = body.default_model;
        }
        if (encrypted) {
          await env.DB.prepare(
            "INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)",
          )
            .bind("ai_openrouter_encrypted", encrypted, now())
            .run();
          const fingerprint = await fingerprintKey(secret);
          if ((await setting(env.DB, "ai_tested_key_fingerprint")) !== fingerprint)
            await env.DB.prepare(
              "DELETE FROM settings WHERE key IN ('ai_last_tested_at','ai_tested_key_fingerprint')",
            ).run();
        }
        await env.DB.prepare(
          "INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)",
        )
          .bind("ai_model_mode", mode, now())
          .run();
        await env.DB.prepare(
          "INSERT OR REPLACE INTO settings(key,value,updated_at) VALUES(?,?,?)",
        )
          .bind("ai_default_model", chosen, now())
          .run();
        return json(
          {
            ok: true,
            has_key:
              Boolean(secret) ||
              Boolean(await setting(env.DB, "ai_openrouter_encrypted")),
            model_mode: mode,
            default_model: chosen,
          },
          200,
          origin,
        );
      }
      if (url.pathname === "/api/ai/settings" && req.method === "DELETE") {
        await env.DB.prepare(
          "DELETE FROM settings WHERE key IN ('ai_openrouter_encrypted','ai_default_model','ai_model_mode','ai_last_tested_at','ai_tested_key_fingerprint')",
        ).run();
        return json({ ok: true }, 200, origin);
      }
      if (url.pathname === "/api/models" && req.method === "GET") {
        const key = await openRouterKey(env.DB, env);
        if (!key)
          return fail(
            "ابتدا کلید OpenRouter را در تنظیمات هوش مصنوعی ذخیره کنید.",
            409,
            origin,
          );
        try {
          const models = await getFreeModels(key);
          return json({ models }, 200, origin);
        } catch (e) {
          return fail(safeError(e), 502, origin);
        }
      }
      if (url.pathname === "/api/settings" && req.method === "GET")
        return json(
          {
            owner_telegram_user_id: await setting(env.DB, "owner_telegram_user_id"),
            telegram_token: env.TELEGRAM_BOT_TOKEN ? "••••••••" : "",
          },
          200,
          origin,
        );
      if (url.pathname === "/api/settings" && req.method === "PUT")
        return fail(
          "تغییر شناسهٔ مالک تلگرام تا زمان پیاده‌سازی تأیید یک‌بارمصرف غیرفعال است.",
          501,
          origin,
        );
      if (url.pathname === "/api/conversations" && req.method === "GET") {
        const r = await env.DB.prepare(
          "SELECT id,title,updated_at,archived FROM conversations WHERE owner_id='owner' AND archived=0 ORDER BY updated_at DESC LIMIT 100",
        ).all();
        return json(r.results, 200, origin);
      }
      if (url.pathname === "/api/conversations" && req.method === "POST") {
        const b: any = await parseJson(req),
          cid = uuid(),
          stamp = now(),
          title = String(b.title || "گفتگوی تازه").slice(0, 160);
        await env.DB.prepare(
          "INSERT INTO conversations(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)",
        )
          .bind(cid, "owner", title, stamp, stamp)
          .run();
        return json({ id: cid, title, updated_at: stamp }, 201, origin);
      }
      const match = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (match) {
        const cid = decodeURIComponent(match[1]),
          conversation: any = await env.DB.prepare(
            "SELECT id FROM conversations WHERE id=? AND owner_id='owner' AND archived=0",
          )
            .bind(cid)
            .first();
        if (!conversation) return fail("گفتگو پیدا نشد.", 404, origin);
        if (req.method === "GET") {
          const rows = await env.DB.prepare(
            "SELECT id,role,content,created_at FROM messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT 300",
          )
            .bind(cid)
            .all();
          return json(rows.results, 200, origin);
        }
        if (req.method === "POST") {
          if (await rateLimited(env.DB, "ai-chat-owner", 30))
            return fail(
              "تعداد پیام‌ها زیاد است؛ یک دقیقه بعد دوباره تلاش کنید.",
              429,
              origin,
            );
          const body: any = await parseJson(req, 96 * 1024);
          if (
            typeof body.content !== "string" ||
            !body.content.trim() ||
            body.content.length > 20000
          )
            return fail("پیام باید بین ۱ تا ۲۰٬۰۰۰ نویسه باشد.", 422, origin);
          const stamp = now();
          await env.DB.prepare(
            "INSERT INTO messages(id,conversation_id,role,content,source,created_at) VALUES(?,?,?,?,?,?)",
          )
            .bind(uuid(), cid, "user", body.content, "web", stamp)
            .run();
          await env.DB.prepare("UPDATE conversations SET updated_at=? WHERE id=?")
            .bind(stamp, cid)
            .run();
          try {
            const pref =
              (await setting(env.DB, "ai_model_mode")) === "manual"
                ? await setting(env.DB, "ai_default_model")
                : undefined;
            return json(
              await answer(env.DB, env, cid, body.content, "web", pref || undefined),
              200,
              origin,
            );
          } catch (e) {
            return fail(safeError(e), Number((e as any)?.status) || 502, origin);
          }
        }
      }
      return fail("درخواست ناشناخته است.", 404, origin);
    } catch (e) {
      return fail(safeError(e), e instanceof ApiError ? e.status : 500, origin);
    }
  },
  async scheduled(_event: unknown, env: Env) {
    await ensure(env.DB);
  },
};
