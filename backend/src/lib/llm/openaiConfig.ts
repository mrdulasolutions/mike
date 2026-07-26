/**
 * OpenAI-compatible endpoint configuration.
 *
 * Env:
 *   OPENAI_API_KEY          – bearer token (or user-stored key)
 *   OPENAI_BASE_URL         – API root, e.g. https://api.openai.com/v1
 *                             https://api.cerebras.ai/v1
 *                             https://bedrock-mantle.us-east-2.api.aws/v1
 *   OPENAI_API_MODE         – auto | responses | chat
 *                             auto: responses for api.openai.com, chat otherwise
 *   OPENAI_MODELS          – comma-separated main-chat model ids (replaces default gpt-* main list when set)
 *   OPENAI_MID_MODELS      – optional mid-tier (tabular) model ids
 *   OPENAI_LOW_MODELS      – optional low-tier (title) model ids
 *   OPENAI_MODEL_LABELS     – optional "id:Label,id2:Label2" display names
 *   OPENAI_COMPAT_ANY_MODEL – if "1"/"true", any non-claude/non-gemini model id
 *                             is accepted and routed through the OpenAI adapter
 *   OPENAI_REQUEST_TIMEOUT_MS – per-request timeout (default 120000)
 */

export type OpenAIApiMode = "responses" | "chat";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const MAX_MODEL_ID_LEN = 128;
const MAX_MODELS_PER_LIST = 200;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Normalize a base URL to an OpenAI-style root (…/v1, no trailing path). */
export function normalizeOpenAIBaseUrl(raw: string | undefined | null): string {
  const fallback = DEFAULT_BASE_URL;
  let url = (raw ?? "").trim() || fallback;
  url = trimSlash(url);
  // Allow pasting a full path; strip known suffixes.
  for (const suffix of [
    "/chat/completions",
    "/responses",
    "/completions",
    "/models",
  ]) {
    if (url.toLowerCase().endsWith(suffix)) {
      url = url.slice(0, -suffix.length);
      url = trimSlash(url);
    }
  }
  return url || fallback;
}

/**
 * Validate base URL for production use: http(s) only, no embedded credentials,
 * https required outside development/localhost.
 */
export function assertSafeOpenAIBaseUrl(raw: string): string {
  const url = normalizeOpenAIBaseUrl(raw);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "Invalid OPENAI_BASE_URL. Expected an absolute URL such as https://api.openai.com/v1",
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("OPENAI_BASE_URL must use http or https.");
  }

  if (parsed.username || parsed.password) {
    throw new Error(
      "OPENAI_BASE_URL must not include username/password. Use OPENAI_API_KEY instead.",
    );
  }

  const host = parsed.hostname.toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local");
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && parsed.protocol !== "https:" && !isLocal) {
    throw new Error(
      "OPENAI_BASE_URL must use https in production (except localhost).",
    );
  }

  return trimSlash(parsed.toString());
}

export function getOpenAIBaseUrl(): string {
  return assertSafeOpenAIBaseUrl(process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL);
}

export function resolveOpenAIApiMode(
  baseUrl: string = getOpenAIBaseUrl(),
  explicit: string | undefined = process.env.OPENAI_API_MODE,
): OpenAIApiMode {
  const mode = (explicit ?? "auto").trim().toLowerCase();
  if (mode === "responses" || mode === "response") return "responses";
  if (
    mode === "chat" ||
    mode === "completions" ||
    mode === "chat_completions"
  ) {
    return "chat";
  }
  // auto
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host === "api.openai.com" || host.endsWith(".openai.azure.com")) {
      return "responses";
    }
  } catch {
    // fall through
  }
  return "chat";
}

export function getOpenAIApiMode(): OpenAIApiMode {
  return resolveOpenAIApiMode();
}

export function openAIResponsesUrl(baseUrl: string = getOpenAIBaseUrl()): string {
  return `${trimSlash(baseUrl)}/responses`;
}

export function openAIChatCompletionsUrl(
  baseUrl: string = getOpenAIBaseUrl(),
): string {
  return `${trimSlash(baseUrl)}/chat/completions`;
}

export function getOpenAIRequestTimeoutMs(): number {
  const raw = process.env.OPENAI_REQUEST_TIMEOUT_MS?.trim();
  if (!raw) return 120_000;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 5_000) return 120_000;
  return Math.min(n, 600_000);
}

/** Merge caller abort with a request timeout (Node 20+ AbortSignal.any). */
export function openAIRequestSignal(user?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(getOpenAIRequestTimeoutMs());
  if (!user) return timeout;
  const anyFn = (
    AbortSignal as unknown as {
      any?: (signals: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof anyFn === "function") {
    return anyFn([user, timeout]);
  }
  return user;
}

function isSafeModelId(id: string): boolean {
  if (!id || id.length > MAX_MODEL_ID_LEN) return false;
  // Printable model ids used by OpenAI-compatible catalogs (no whitespace/control).
  return /^[\w.:/=+\-@]+$/.test(id);
}

function parseCsv(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id || !isSafeModelId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_MODELS_PER_LIST) break;
  }
  return out;
}

export function parseOpenAIModelLabels(
  raw: string | undefined | null = process.env.OPENAI_MODEL_LABELS,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw?.trim()) return out;
  for (const part of raw.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const id = part.slice(0, idx).trim();
    const label = part.slice(idx + 1).trim().slice(0, 80);
    if (id && label && isSafeModelId(id)) out[id] = label;
  }
  return out;
}

export function envOpenAIMainModels(): string[] | null {
  const list = parseCsv(process.env.OPENAI_MODELS);
  return list.length ? list : null;
}

export function envOpenAIMidModels(): string[] | null {
  const list = parseCsv(process.env.OPENAI_MID_MODELS);
  return list.length ? list : null;
}

export function envOpenAILowModels(): string[] | null {
  const list = parseCsv(process.env.OPENAI_LOW_MODELS);
  return list.length ? list : null;
}

export function isOpenAICompatAnyModel(): boolean {
  const v = (process.env.OPENAI_COMPAT_ANY_MODEL ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function humanizeModelId(id: string): string {
  const labels = parseOpenAIModelLabels();
  if (labels[id]) return labels[id];
  return id
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Host only — safe to expose in public config endpoints. */
export function getOpenAIBaseUrlHost(): string | null {
  try {
    return new URL(getOpenAIBaseUrl()).host;
  } catch {
    return null;
  }
}
