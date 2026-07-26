import { afterEach, describe, expect, it } from "vitest";
import {
  getOpenAIApiMode,
  getOpenAIBaseUrl,
  humanizeModelId,
  normalizeOpenAIBaseUrl,
  openAIChatCompletionsUrl,
  openAIResponsesUrl,
  parseOpenAIModelLabels,
  resolveOpenAIApiMode,
} from "../llm/openaiConfig";

const ENV_KEYS = [
  "OPENAI_BASE_URL",
  "OPENAI_API_MODE",
  "OPENAI_MODELS",
  "OPENAI_MODEL_LABELS",
  "OPENAI_COMPAT_ANY_MODEL",
] as const;

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (key in saved) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
      delete saved[key];
    } else {
      delete process.env[key];
    }
  }
});

function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("normalizeOpenAIBaseUrl", () => {
  it("defaults to api.openai.com/v1", () => {
    expect(normalizeOpenAIBaseUrl("")).toBe("https://api.openai.com/v1");
    expect(normalizeOpenAIBaseUrl(null)).toBe("https://api.openai.com/v1");
  });

  it("strips trailing slash and known suffixes", () => {
    expect(
      normalizeOpenAIBaseUrl("https://api.cerebras.ai/v1/"),
    ).toBe("https://api.cerebras.ai/v1");
    expect(
      normalizeOpenAIBaseUrl(
        "https://bedrock-mantle.us-east-2.api.aws/v1/chat/completions",
      ),
    ).toBe("https://bedrock-mantle.us-east-2.api.aws/v1");
    expect(
      normalizeOpenAIBaseUrl("https://api.openai.com/v1/responses"),
    ).toBe("https://api.openai.com/v1");
  });
});

describe("resolveOpenAIApiMode", () => {
  it("uses responses for api.openai.com in auto mode", () => {
    expect(
      resolveOpenAIApiMode("https://api.openai.com/v1", "auto"),
    ).toBe("responses");
  });

  it("uses chat for non-OpenAI hosts in auto mode", () => {
    expect(
      resolveOpenAIApiMode("https://api.cerebras.ai/v1", "auto"),
    ).toBe("chat");
    expect(
      resolveOpenAIApiMode(
        "https://bedrock-mantle.us-east-2.api.aws/v1",
        "auto",
      ),
    ).toBe("chat");
  });

  it("honors explicit mode", () => {
    expect(
      resolveOpenAIApiMode("https://api.openai.com/v1", "chat"),
    ).toBe("chat");
    expect(
      resolveOpenAIApiMode("https://api.cerebras.ai/v1", "responses"),
    ).toBe("responses");
  });
});

describe("URL builders", () => {
  it("builds responses and chat URLs", () => {
    expect(openAIResponsesUrl("https://api.openai.com/v1")).toBe(
      "https://api.openai.com/v1/responses",
    );
    expect(openAIChatCompletionsUrl("https://api.cerebras.ai/v1")).toBe(
      "https://api.cerebras.ai/v1/chat/completions",
    );
  });
});

describe("env helpers", () => {
  it("reads base url and mode from env", () => {
    setEnv("OPENAI_BASE_URL", "https://api.cerebras.ai/v1");
    setEnv("OPENAI_API_MODE", "auto");
    expect(getOpenAIBaseUrl()).toBe("https://api.cerebras.ai/v1");
    expect(getOpenAIApiMode()).toBe("chat");
  });

  it("parses model labels", () => {
    expect(
      parseOpenAIModelLabels("xai.grok-4.3:Grok 4.3,zai.glm-5:GLM 5"),
    ).toEqual({
      "xai.grok-4.3": "Grok 4.3",
      "zai.glm-5": "GLM 5",
    });
  });

  it("humanizes model ids", () => {
    setEnv("OPENAI_MODEL_LABELS", "xai.grok-4.3:Grok 4.3");
    expect(humanizeModelId("xai.grok-4.3")).toBe("Grok 4.3");
    expect(humanizeModelId("my-custom-model")).toMatch(/My Custom Model/i);
  });
});
