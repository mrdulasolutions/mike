import type { Provider } from "./types";
import {
  envOpenAILowModels,
  envOpenAIMainModels,
  envOpenAIMidModels,
  humanizeModelId,
  isOpenAICompatAnyModel,
} from "./openaiConfig";

// ---------------------------------------------------------------------------
// Canonical model IDs
// ---------------------------------------------------------------------------
// Main-chat tier (top-end) — user picks one of these per message.
export const CLAUDE_MAIN_MODELS = [
  "claude-fable-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
] as const;
export const GEMINI_MAIN_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
] as const;
export const DEFAULT_OPENAI_MAIN_MODELS = ["gpt-5.5", "gpt-5.4"] as const;

// Mid-tier (used for tabular review) — user picks one in account settings.
export const CLAUDE_MID_MODELS = ["claude-sonnet-4-6"] as const;
export const GEMINI_MID_MODELS = [
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
] as const;
export const DEFAULT_OPENAI_MID_MODELS = ["gpt-5.4"] as const;

// Low-tier (used for title generation, lightweight extractions) — user picks
// one in account settings.
export const CLAUDE_LOW_MODELS = ["claude-haiku-4-5"] as const;
export const GEMINI_LOW_MODELS = ["gemini-3.1-flash-lite-preview"] as const;
export const DEFAULT_OPENAI_LOW_MODELS = ["gpt-5.4-lite"] as const;

/** Resolved at call time so env changes apply without recompile. */
export function getOpenAIMainModels(): string[] {
  return envOpenAIMainModels() ?? [...DEFAULT_OPENAI_MAIN_MODELS];
}

export function getOpenAIMidModels(): string[] {
  return envOpenAIMidModels() ?? [...DEFAULT_OPENAI_MID_MODELS];
}

export function getOpenAILowModels(): string[] {
  return envOpenAILowModels() ?? [...DEFAULT_OPENAI_LOW_MODELS];
}

/** @deprecated Prefer getOpenAIMainModels() — kept for tests/imports. */
export const OPENAI_MAIN_MODELS = DEFAULT_OPENAI_MAIN_MODELS;
/** @deprecated Prefer getOpenAIMidModels() */
export const OPENAI_MID_MODELS = DEFAULT_OPENAI_MID_MODELS;
/** @deprecated Prefer getOpenAILowModels() */
export const OPENAI_LOW_MODELS = DEFAULT_OPENAI_LOW_MODELS;

export const DEFAULT_MAIN_MODEL = "gemini-3-flash-preview";
export const DEFAULT_TITLE_MODEL = "gemini-3.1-flash-lite-preview";
export const DEFAULT_TABULAR_MODEL = "gemini-3-flash-preview";

function builtInCatalog(): Set<string> {
  return new Set<string>([
    ...CLAUDE_MAIN_MODELS,
    ...GEMINI_MAIN_MODELS,
    ...CLAUDE_MID_MODELS,
    ...GEMINI_MID_MODELS,
    ...CLAUDE_LOW_MODELS,
    ...GEMINI_LOW_MODELS,
    ...getOpenAIMainModels(),
    ...getOpenAIMidModels(),
    ...getOpenAILowModels(),
  ]);
}

function isOpenAICatalogModel(model: string): boolean {
  return (
    getOpenAIMainModels().includes(model) ||
    getOpenAIMidModels().includes(model) ||
    getOpenAILowModels().includes(model)
  );
}

// ---------------------------------------------------------------------------
// Provider inference
// ---------------------------------------------------------------------------

export function providerForModel(model: string): Provider {
  if (model.startsWith("claude")) return "claude";
  if (model.startsWith("gemini")) return "gemini";
  if (model.startsWith("gpt-")) return "openai";
  if (isOpenAICatalogModel(model)) return "openai";
  if (isOpenAICompatAnyModel()) {
    // Route any remaining id through the OpenAI-compatible adapter
    // (Mantle, Cerebras, vLLM, etc.).
    if (model.trim()) return "openai";
  }
  throw new Error(`Unknown model id: ${model}`);
}

function isSafeModelId(id: string): boolean {
  return id.length > 0 && id.length <= 128 && /^[\w.:/=+\-@]+$/.test(id);
}

export function resolveModel(
  id: string | null | undefined,
  fallback: string,
): string {
  if (!id?.trim() || !isSafeModelId(id)) return fallback;
  if (builtInCatalog().has(id)) return id;
  // When OpenAI-compat any-model mode is on, accept arbitrary non-Anthropic /
  // non-Gemini ids (Bedrock Mantle, Cerebras, local vLLM, etc.).
  if (
    isOpenAICompatAnyModel() &&
    !id.startsWith("claude") &&
    !id.startsWith("gemini")
  ) {
    return id;
  }
  return fallback;
}

export type PublicModelOption = {
  id: string;
  label: string;
  group: "Anthropic" | "Google" | "OpenAI";
  tier: "main" | "mid" | "low";
};

export function listPublicModels(): {
  main: PublicModelOption[];
  settings: PublicModelOption[];
} {
  const main: PublicModelOption[] = [
    ...CLAUDE_MAIN_MODELS.map((id) => ({
      id,
      label: humanizeModelId(id),
      group: "Anthropic" as const,
      tier: "main" as const,
    })),
    ...GEMINI_MAIN_MODELS.map((id) => ({
      id,
      label: humanizeModelId(id),
      group: "Google" as const,
      tier: "main" as const,
    })),
    ...getOpenAIMainModels().map((id) => ({
      id,
      label: humanizeModelId(id),
      group: "OpenAI" as const,
      tier: "main" as const,
    })),
  ];

  // Settings = main + low-tier (and mid already in main for most)
  const low: PublicModelOption[] = [
    ...CLAUDE_LOW_MODELS.map((id) => ({
      id,
      label: humanizeModelId(id),
      group: "Anthropic" as const,
      tier: "low" as const,
    })),
    ...GEMINI_LOW_MODELS.map((id) => ({
      id,
      label: humanizeModelId(id),
      group: "Google" as const,
      tier: "low" as const,
    })),
    ...getOpenAILowModels().map((id) => ({
      id,
      label: humanizeModelId(id),
      group: "OpenAI" as const,
      tier: "low" as const,
    })),
  ];

  // Prefer pretty built-in labels for known Anthropic/Google ids
  const pretty: Record<string, string> = {
    "claude-fable-5": "Claude Fable 5",
    "claude-opus-4-8": "Claude Opus 4.8",
    "claude-opus-4-7": "Claude Opus 4.7",
    "claude-sonnet-4-6": "Claude Sonnet 4.6",
    "claude-haiku-4-5": "Claude Haiku 4.5",
    "gemini-3.5-flash": "Gemini 3.5 Flash",
    "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
    "gemini-3-flash-preview": "Gemini 3 Flash",
    "gemini-3.1-flash-lite-preview": "Gemini 3.1 Flash Lite",
    "gpt-5.5": "GPT-5.5",
    "gpt-5.4": "GPT-5.4",
    "gpt-5.4-lite": "GPT-5.4 Lite",
  };
  for (const m of [...main, ...low]) {
    if (pretty[m.id]) m.label = pretty[m.id];
  }

  const settingsIds = new Set(main.map((m) => m.id));
  const settings = [...main];
  for (const m of low) {
    if (!settingsIds.has(m.id)) settings.push(m);
  }

  return { main, settings };
}
