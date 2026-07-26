/**
 * Model catalog: built-in defaults + optional backend /config/models overlay
 * so OPENAI_MODELS / custom OpenAI-compatible endpoints show in the UI.
 */

import type { ModelOption } from "@/app/components/assistant/ModelToggle";

const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

export const BUILTIN_MAIN_MODELS: ModelOption[] = [
    { id: "claude-fable-5", label: "Claude Fable 5", group: "Anthropic" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", group: "Anthropic" },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", group: "Anthropic" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", group: "Anthropic" },
    { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", group: "Google" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", group: "Google" },
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash", group: "Google" },
    { id: "gpt-5.5", label: "GPT-5.5", group: "OpenAI" },
    { id: "gpt-5.4", label: "GPT-5.4", group: "OpenAI" },
];

export const BUILTIN_SETTINGS_MODELS: ModelOption[] = [
    ...BUILTIN_MAIN_MODELS,
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", group: "Anthropic" },
    {
        id: "gemini-3.1-flash-lite-preview",
        label: "Gemini 3.1 Flash Lite",
        group: "Google",
    },
    { id: "gpt-5.4-lite", label: "GPT-5.4 Lite", group: "OpenAI" },
];

export type ModelCatalog = {
    main: ModelOption[];
    settings: ModelOption[];
    openai?: {
        baseUrlConfigured?: boolean;
        baseUrlHost?: string | null;
        apiMode?: string;
        compatAnyModel?: boolean;
    };
};

let cached: ModelCatalog | null = null;
let inflight: Promise<ModelCatalog> | null = null;

function normalizeOption(raw: {
    id?: string;
    label?: string;
    group?: string;
}): ModelOption | null {
    if (!raw?.id) return null;
    const group =
        raw.group === "Anthropic" || raw.group === "Google" || raw.group === "OpenAI"
            ? raw.group
            : "OpenAI";
    return {
        id: raw.id,
        label: raw.label?.trim() || raw.id,
        group,
    };
}

export function getBuiltinCatalog(): ModelCatalog {
    return {
        main: BUILTIN_MAIN_MODELS,
        settings: BUILTIN_SETTINGS_MODELS,
    };
}

export async function fetchModelCatalog(): Promise<ModelCatalog> {
    if (cached) return cached;
    if (inflight) return inflight;

    inflight = (async () => {
        try {
            const res = await fetch(`${API_BASE}/config/models`, {
                cache: "no-store",
            });
            if (!res.ok) throw new Error(`config/models ${res.status}`);
            const data = (await res.json()) as {
                main?: { id: string; label: string; group: string }[];
                settings?: { id: string; label: string; group: string }[];
                openai?: ModelCatalog["openai"];
            };
            const main = (data.main ?? [])
                .map(normalizeOption)
                .filter((m): m is ModelOption => !!m);
            const settings = (data.settings ?? [])
                .map(normalizeOption)
                .filter((m): m is ModelOption => !!m);
            cached = {
                main: main.length ? main : BUILTIN_MAIN_MODELS,
                settings: settings.length ? settings : BUILTIN_SETTINGS_MODELS,
                openai: data.openai,
            };
            return cached;
        } catch {
            cached = getBuiltinCatalog();
            return cached;
        } finally {
            inflight = null;
        }
    })();

    return inflight;
}

/** Test helper / HMR: clear catalog cache. */
export function clearModelCatalogCache() {
    cached = null;
    inflight = null;
}
