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
 */

export type OpenAIApiMode = "responses" | "chat";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

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

export function getOpenAIBaseUrl(): string {
  return normalizeOpenAIBaseUrl(process.env.OPENAI_BASE_URL);
}

export function resolveOpenAIApiMode(
  baseUrl: string = getOpenAIBaseUrl(),
  explicit: string | undefined = process.env.OPENAI_API_MODE,
): OpenAIApiMode {
  const mode = (explicit ?? "auto").trim().toLowerCase();
  if (mode === "responses" || mode === "response") return "responses";
  if (mode === "chat" || mode === "completions" || mode === "chat_completions") {
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

function parseCsv(raw: string | undefined | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
    const label = part.slice(idx + 1).trim();
    if (id && label) out[id] = label;
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
  // xai.grok-4.3 → xai grok 4.3
  return id
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
