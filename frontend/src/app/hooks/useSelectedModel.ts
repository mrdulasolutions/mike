"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_MODEL_ID } from "../components/assistant/ModelToggle";
import { fetchModelCatalog } from "@/app/lib/modelCatalog";

const STORAGE_KEY = "mike.selectedModel";

export function useSelectedModel(): [string, (id: string) => void] {
    const [model, setModelState] = useState<string>(DEFAULT_MODEL_ID);
    const [allowed, setAllowed] = useState<Set<string> | null>(null);
    const [compatAny, setCompatAny] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetchModelCatalog().then((catalog) => {
            if (cancelled) return;
            const ids = new Set(catalog.main.map((m) => m.id));
            const any = !!catalog.openai?.compatAnyModel;
            setAllowed(ids);
            setCompatAny(any);
            const raw =
                typeof window !== "undefined"
                    ? window.localStorage.getItem(STORAGE_KEY)
                    : null;
            if (raw && (ids.has(raw) || any)) {
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
            const accepted =
                !allowed || // catalog not loaded yet — accept, backend validates
                allowed.has(id) ||
                compatAny;
            const next = accepted ? id : DEFAULT_MODEL_ID;
            setModelState(next);
            if (typeof window !== "undefined") {
                window.localStorage.setItem(STORAGE_KEY, next);
            }
        },
        [allowed, compatAny],
    );

    return [model, setModel];
}
