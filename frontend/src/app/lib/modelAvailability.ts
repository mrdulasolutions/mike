import {
    SETTINGS_MODELS,
    type ModelOption,
} from "../components/assistant/ModelToggle";
import type { ApiKeyState } from "@/app/lib/mikeApi";

export type ModelProvider = "claude" | "gemini" | "openai";

export function getModelProvider(
    modelId: string,
    catalog: ModelOption[] = SETTINGS_MODELS,
): ModelProvider | null {
    const model = catalog.find((m) => m.id === modelId);
    if (model) return modelGroupToProvider(model.group);
    // Prefix fallback when catalog has not loaded custom OpenAI ids yet
    if (modelId.startsWith("claude")) return "claude";
    if (modelId.startsWith("gemini")) return "gemini";
    if (modelId.startsWith("gpt-") || modelId.includes(".")) return "openai";
    return null;
}

export function isModelAvailable(
    modelId: string,
    apiKeys: ApiKeyState,
    catalog?: ModelOption[],
): boolean {
    const provider = getModelProvider(modelId, catalog ?? SETTINGS_MODELS);
    if (!provider) {
        // Unknown id: treat as OpenAI-compatible if openai key is present
        return isProviderAvailable("openai", apiKeys);
    }
    return isProviderAvailable(provider, apiKeys);
}

export function isProviderAvailable(
    provider: ModelProvider,
    apiKeys: ApiKeyState,
): boolean {
    return !!apiKeys[provider]?.configured;
}

export function providerLabel(provider: ModelProvider): string {
    if (provider === "claude") return "Anthropic (Claude)";
    if (provider === "openai") return "OpenAI-compatible";
    return "Google (Gemini)";
}

export function modelGroupToProvider(
    group: ModelOption["group"],
): ModelProvider {
    if (group === "Anthropic") return "claude";
    if (group === "OpenAI") return "openai";
    return "gemini";
}
