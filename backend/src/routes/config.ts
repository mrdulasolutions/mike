import { Router } from "express";
import { listPublicModels } from "../lib/llm/models";
import {
  getOpenAIApiMode,
  getOpenAIBaseUrlHost,
  isOpenAICompatAnyModel,
} from "../lib/llm/openaiConfig";

export const configRouter = Router();

/**
 * Public (no auth) model catalog + OpenAI-compatible endpoint metadata.
 * Does not expose API keys, full base URLs, or secrets — only host + mode.
 */
configRouter.get("/models", (_req, res) => {
  try {
    const { main, settings } = listPublicModels();
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      main,
      settings,
      defaults: {
        main: process.env.DEFAULT_MAIN_MODEL || undefined,
        title: process.env.DEFAULT_TITLE_MODEL || undefined,
        tabular: process.env.DEFAULT_TABULAR_MODEL || undefined,
      },
      openai: {
        baseUrlConfigured: !!process.env.OPENAI_BASE_URL?.trim(),
        baseUrlHost: getOpenAIBaseUrlHost(),
        apiMode: getOpenAIApiMode(),
        compatAnyModel: isOpenAICompatAnyModel(),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load model config";
    res.status(500).json({ detail: message });
  }
});
