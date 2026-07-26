import { Router } from "express";
import { listPublicModels } from "../lib/llm/models";
import {
  getOpenAIApiMode,
  getOpenAIBaseUrl,
  isOpenAICompatAnyModel,
} from "../lib/llm/openaiConfig";

export const configRouter = Router();

/**
 * Public (no auth) model catalog + OpenAI-compatible endpoint metadata.
 * Does not expose API keys or full credentials — only whether a custom base
 * URL is configured and which API mode is active.
 */
configRouter.get("/models", (_req, res) => {
  const { main, settings } = listPublicModels();
  const baseUrl = getOpenAIBaseUrl();
  const isDefaultOpenAI = baseUrl === "https://api.openai.com/v1";
  res.json({
    main,
    settings,
    defaults: {
      main: process.env.DEFAULT_MAIN_MODEL || undefined,
      title: process.env.DEFAULT_TITLE_MODEL || undefined,
      tabular: process.env.DEFAULT_TABULAR_MODEL || undefined,
    },
    openai: {
      baseUrlConfigured: !isDefaultOpenAI || !!process.env.OPENAI_BASE_URL,
      baseUrlHost: (() => {
        try {
          return new URL(baseUrl).host;
        } catch {
          return null;
        }
      })(),
      apiMode: getOpenAIApiMode(),
      compatAnyModel: isOpenAICompatAnyModel(),
    },
  });
});
