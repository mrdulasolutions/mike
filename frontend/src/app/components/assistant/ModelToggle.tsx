"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Check, AlertCircle } from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import {
    LiquidDropdownContent,
    LiquidDropdownItem,
} from "@/app/components/ui/liquid-dropdown";
import { isModelAvailable } from "@/app/lib/modelAvailability";
import {
    BUILTIN_MAIN_MODELS,
    BUILTIN_SETTINGS_MODELS,
    fetchModelCatalog,
} from "@/app/lib/modelCatalog";
import type { ApiKeyState } from "@/app/lib/mikeApi";

export interface ModelOption {
    id: string;
    label: string;
    group: "Anthropic" | "Google" | "OpenAI";
}

/** Default main-chat models (before /config/models loads). */
export const MODELS: ModelOption[] = BUILTIN_MAIN_MODELS;

/** Default settings models (title/tabular pickers). */
export const SETTINGS_MODELS: ModelOption[] = BUILTIN_SETTINGS_MODELS;

export const DEFAULT_MODEL_ID = "gemini-3-flash-preview";

export const ALLOWED_MODEL_IDS = new Set(MODELS.map((m) => m.id));

const GROUP_ORDER: ModelOption["group"][] = ["Anthropic", "Google", "OpenAI"];
const itemClassName =
    "rounded-xl px-2.5 py-1.5 text-gray-700 focus:bg-app-surface-hover focus:text-gray-900 data-[highlighted]:bg-app-surface-hover data-[highlighted]:text-gray-900";

interface Props {
    value: string;
    onChange: (id: string) => void;
    apiKeys?: ApiKeyState;
    /** When set, use this list instead of the live catalog (e.g. settings page). */
    options?: ModelOption[];
}

export function useLiveModels(kind: "main" | "settings" = "main"): ModelOption[] {
    const [models, setModels] = useState<ModelOption[]>(
        kind === "settings" ? SETTINGS_MODELS : MODELS,
    );

    useEffect(() => {
        let cancelled = false;
        fetchModelCatalog().then((catalog) => {
            if (cancelled) return;
            setModels(kind === "settings" ? catalog.settings : catalog.main);
        });
        return () => {
            cancelled = true;
        };
    }, [kind]);

    return models;
}

export function ModelToggle({ value, onChange, apiKeys, options }: Props) {
    const live = useLiveModels("main");
    const models = options ?? live;
    const [isOpen, setIsOpen] = useState(false);
    const selected = models.find((m) => m.id === value);
    const selectedLabel = selected?.label ?? value ?? "Model";
    const selectedAvailable = apiKeys
        ? isModelAvailable(value, apiKeys, models)
        : true;

    return (
        <DropdownMenu onOpenChange={setIsOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2 text-sm text-gray-400 transition-colors hover:text-gray-700 ${isOpen ? "text-gray-700" : ""}`}
                    title={
                        !selectedAvailable
                            ? "API key missing for selected model"
                            : "Choose model"
                    }
                >
                    {!selectedAvailable && (
                        <AlertCircle className="h-3 w-3 shrink-0 text-red-500" />
                    )}
                    <span className="max-w-[140px] truncate">{selectedLabel}</span>
                    <ChevronDown
                        className={`h-3 w-3 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                </button>
            </DropdownMenuTrigger>
            <LiquidDropdownContent
                className="z-50 w-56 p-1.5 text-gray-700"
                side="top"
                align="end"
            >
                {GROUP_ORDER.map((group, gi) => {
                    const items = models.filter((m) => m.group === group);
                    if (items.length === 0) return null;
                    return (
                        <div key={group}>
                            {gi > 0 && (
                                <DropdownMenuSeparator className="-mx-1 my-1 bg-white/70" />
                            )}
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-gray-400">
                                {group === "OpenAI" ? "OpenAI-compatible" : group}
                            </DropdownMenuLabel>
                            {items.map((m) => {
                                const available = apiKeys
                                    ? isModelAvailable(m.id, apiKeys, models)
                                    : true;
                                return (
                                    <LiquidDropdownItem
                                        key={m.id}
                                        className={`${itemClassName} ${m.id === value ? "bg-app-surface-hover text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]" : ""}`}
                                        onSelect={() => onChange(m.id)}
                                    >
                                        <span
                                            className={`flex-1 ${available ? "" : "text-gray-400"}`}
                                        >
                                            {m.label}
                                        </span>
                                        {!available && (
                                            <AlertCircle
                                                className="h-3.5 w-3.5 text-red-500 ml-1"
                                                aria-label="API key missing"
                                            />
                                        )}
                                        {m.id === value && available && (
                                            <Check className="h-3.5 w-3.5 text-gray-600 ml-1" />
                                        )}
                                    </LiquidDropdownItem>
                                );
                            })}
                        </div>
                    );
                })}
            </LiquidDropdownContent>
        </DropdownMenu>
    );
}
