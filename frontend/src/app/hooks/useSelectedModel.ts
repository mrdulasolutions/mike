"use client";

import { useCallback, useEffect, useState } from "react";
import {
    DEFAULT_MODEL_ID,
} from "../components/assistant/ModelToggle";
import { fetchModelCatalog } from "@/app/lib/modelCatalog";

const STORAGE_KEY = "mike.selectedModel";

export function useSelectedModel(): [string, (id: string) => void] {
    const [model, setModelState] = useState<string>(DEFAULT_MODEL_ID);
    const [allowed, setAllowed] = useState<Set<string> | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchModelCatalog().then((catalog) => {
            if (cancelled) return;
            const ids = new Set(catalog.main.map((m) => m.id));
            setAllowed(ids);
            const raw =
                typeof window !== "undefined"
                    ? window.localStorage.getItem(STORAGE_KEY)
                    : null;
            if (raw && ids.has(raw)) {
                setModelState(raw);
            } else if (raw && catalog.openai?.compatAnyModel) {
                // Allow arbitrary stored id when server accepts any OpenAI model
                setModelState(raw);
            } else {
                setModelState(DEFAULT_MODEL_ID);
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const setModel = useCallback(
        (id: string) => {
            const ok =
                !allowed ||
                allowed.has(id) ||
                // optimistic accept; backend resolveModel is source of truth
                true;
            const next = ok ? id : DEFAULT_MODEL_ID;
            setModelState(next);
            if (typeof window !== "undefined") {
                window.localStorage.setItem(STORAGE_KEY, next);
            }
        },
        [allowed],
    );

    return [model, setModel];
}
