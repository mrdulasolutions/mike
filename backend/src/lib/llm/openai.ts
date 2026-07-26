import type {
  LlmMessage,
  NormalizedToolCall,
  NormalizedToolResult,
  OpenAIToolSchema,
  StreamChatParams,
  StreamChatResult,
} from "./types";
import { createRawLlmStreamRecorder, logRawLlmStream } from "./rawStreamLog";
import {
  getOpenAIApiMode,
  getOpenAIBaseUrl,
  openAIChatCompletionsUrl,
  openAIRequestSignal,
  openAIResponsesUrl,
  type OpenAIApiMode,
} from "./openaiConfig";

const MAX_OUTPUT_TOKENS = 16384;
const COURTLISTENER_CITATION_REMINDER_TOOL_NAMES = new Set([
  "courtlistener_find_in_case",
  "courtlistener_read_case",
]);
const COURTLISTENER_CITATION_REMINDER = `COURTLISTENER CITATION REMINDER:
If your final answer relies on any CourtListener case, every such case reference must have BOTH a clickable markdown case link and an inline [N] marker.
Include the clickable case link only the first time you cite that case; later references to the same case should reuse the existing inline [N] marker without repeating the link unless clarity requires it.
Assign new refs in first-use order as much as possible: [1], then [2], then [3]. Reuse an existing ref when citing the same case/passage again, even if that means a later sentence cites [3] and then [1] again.
End the response with a <CITATIONS> block containing one matching case entry per [N] marker:
{"ref": N, "cluster_id": 123, "quotes": [{"opinion_id": 456, "quote": "exact verbatim opinion text"}]}.
Do not use doc_id, page, top-level quote, case_name, or citation fields for CourtListener case entries.`;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

type ResponseInputItem =
  | { role: "user" | "assistant"; content: string }
  | { type: "function_call_output"; call_id: string; output: string };

type ResponseFunctionTool = {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

type ResponseFunctionCallItem = {
  type: "function_call";
  call_id?: string;
  name?: string;
  arguments?: string;
};

type ResponseStreamEvent = {
  type?: string;
  delta?: string;
  response?: {
    id?: string;
    output_text?: string;
    status?: string;
    error?: { code?: string; message?: string } | null;
  };
  error?: { code?: string; message?: string } | null;
  item?: ResponseFunctionCallItem;
};

type ChatMessage =
  | { role: "system" | "user" | "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

function apiKey(override?: string | null): string {
  const key = override?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  if (!key) {
    throw new Error(
      "OpenAI API key is not configured. Set OPENAI_API_KEY or add a user OpenAI key.",
    );
  }
  return key;
}

function toResponseTools(tools: OpenAIToolSchema[]): ResponseFunctionTool[] {
  return tools.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

function toChatTools(tools: OpenAIToolSchema[]) {
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }));
}

function toResponseInput(messages: LlmMessage[]): ResponseInputItem[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function extractSseJson(
  buffer: string,
  opts?: { flush?: boolean },
): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  const chunks = buffer.split(/\n\n/);
  const rest = opts?.flush ? "" : (chunks.pop() ?? "");
  if (opts?.flush && chunks.length === 0 && buffer.trim()) {
    // Final partial frame without trailing blank line.
    chunks.push(buffer);
  }

  for (const chunk of chunks) {
    const dataLines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    for (const data of dataLines) {
      if (!data || data === "[DONE]") continue;
      try {
        events.push(JSON.parse(data));
      } catch {
        // Incomplete events stay buffered until the next read (or drop on flush).
      }
    }
  }

  return { events, rest };
}

function parseFunctionCall(item: ResponseFunctionCallItem): NormalizedToolCall {
  let input: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(item.arguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      input = parsed as Record<string, unknown>;
    }
  } catch {
    input = {};
  }

  return {
    id: item.call_id ?? item.name ?? "function_call",
    name: item.name ?? "",
    input,
  };
}

function openAIStreamFailureMessage(event: ResponseStreamEvent): string | null {
  const error = event.response?.error ?? event.error ?? null;
  const failed =
    event.type === "response.failed" ||
    event.response?.status === "failed" ||
    !!error;
  if (!failed) return null;

  const message =
    typeof error?.message === "string" && error.message.trim()
      ? error.message.trim()
      : "OpenAI response failed.";
  const code =
    typeof error?.code === "string" && error.code.trim()
      ? error.code.trim()
      : null;
  return code ? `OpenAI error (${code}): ${message}` : message;
}

function abortError(): Error {
  const err = new Error("Stream aborted.");
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function responseInstructions(systemPrompt: string, includeReminder: boolean) {
  return includeReminder
    ? `${systemPrompt}\n\n${COURTLISTENER_CITATION_REMINDER}`
    : systemPrompt;
}

function shouldAppendCourtlistenerCitationReminder(call: NormalizedToolCall) {
  return COURTLISTENER_CITATION_REMINDER_TOOL_NAMES.has(call.name);
}

function requestHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "openai-compatible-endpoint";
  }
}

function truncateErrorBody(body: string, max = 400): string {
  const cleaned = body.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

async function postJson(params: {
  url: string;
  apiKey: string;
  body: unknown;
  signal?: AbortSignal;
}): Promise<Response> {
  const signal = openAIRequestSignal(params.signal);
  let response: Response;
  try {
    response = await fetch(params.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params.body),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (params.signal?.aborted) throw abortError();
      const err = new Error(
        `OpenAI request timed out talking to ${requestHost(params.url)}.`,
      );
      err.name = "TimeoutError";
      throw err;
    }
    throw error;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const err = new Error(
      `OpenAI request failed (${response.status}) via ${requestHost(params.url)}: ${
        truncateErrorBody(text) || response.statusText
      }`,
    );
    (err as { status?: number }).status = response.status;
    throw err;
  }

  return response;
}

// ---------------------------------------------------------------------------
// Responses API (OpenAI native)
// ---------------------------------------------------------------------------

async function createResponse(params: {
  model: string;
  input: ResponseInputItem[];
  instructions?: string;
  tools?: ResponseFunctionTool[];
  stream?: boolean;
  maxTokens?: number;
  previousResponseId?: string;
  reasoningSummary?: boolean;
  apiKey: string;
  signal?: AbortSignal;
  baseUrl?: string;
}): Promise<Response> {
  const baseUrl = params.baseUrl ?? getOpenAIBaseUrl();
  return postJson({
    url: openAIResponsesUrl(baseUrl),
    apiKey: params.apiKey,
    signal: params.signal,
    body: {
      model: params.model,
      instructions: params.instructions || undefined,
      input: params.input,
      tools: params.tools?.length ? params.tools : undefined,
      stream: params.stream,
      max_output_tokens: params.maxTokens ?? MAX_OUTPUT_TOKENS,
      previous_response_id: params.previousResponseId,
      reasoning: params.reasoningSummary ? { summary: "auto" } : undefined,
    },
  });
}

async function streamOpenAIResponses(
  params: StreamChatParams,
): Promise<StreamChatResult> {
  const {
    model,
    systemPrompt,
    tools = [],
    callbacks = {},
    runTools,
    apiKeys,
    enableThinking,
  } = params;
  const maxIter = params.maxIterations ?? 10;
  const key = apiKey(apiKeys?.openai);
  const responseTools = toResponseTools(tools);
  let input = toResponseInput(params.messages);
  let previousResponseId: string | undefined;
  let fullText = "";
  let needsCourtlistenerCitationReminder = false;
  const rawStreamRecorder = createRawLlmStreamRecorder({
    provider: "openai",
    model,
  });

  try {
    for (let iter = 0; iter < maxIter; iter++) {
      throwIfAborted(params.abortSignal);
      const response = await createResponse({
        model,
        instructions: responseInstructions(
          systemPrompt,
          needsCourtlistenerCitationReminder,
        ),
        input,
        tools: responseTools,
        stream: true,
        previousResponseId,
        reasoningSummary: !!enableThinking,
        apiKey: key,
        signal: params.abortSignal,
      });
      if (!response.body) throw new Error("OpenAI response had no body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const toolCalls: NormalizedToolCall[] = [];
      const startedToolCallIds = new Set<string>();
      let buffer = "";
      let sawReasoning = false;

      const handleResponseEvents = (events: ResponseStreamEvent[]) => {
        for (const event of events) {
          logRawLlmStream({
            provider: "openai",
            model,
            iteration: iter,
            label: "sse_event",
            payload: event,
          });
          rawStreamRecorder?.record({
            iteration: iter,
            label: "sse_event",
            payload: event,
          });

          const failureMessage = openAIStreamFailureMessage(event);
          if (failureMessage) {
            throw new Error(failureMessage);
          }

          if (event.response?.id) {
            previousResponseId = event.response.id;
          }

          if (
            event.type === "response.reasoning_summary_text.delta" &&
            typeof event.delta === "string"
          ) {
            sawReasoning = true;
            callbacks.onReasoningDelta?.(event.delta);
          }

          if (
            event.type === "response.output_text.delta" &&
            typeof event.delta === "string"
          ) {
            fullText += event.delta;
            callbacks.onContentDelta?.(event.delta);
          }

          if (
            event.type === "response.output_item.added" &&
            event.item?.type === "function_call"
          ) {
            const call = parseFunctionCall(event.item);
            startedToolCallIds.add(call.id);
            callbacks.onToolCallStart?.(call);
          }

          if (
            event.type === "response.output_item.done" &&
            event.item?.type === "function_call"
          ) {
            const call = parseFunctionCall(event.item);
            if (!startedToolCallIds.has(call.id)) {
              callbacks.onToolCallStart?.(call);
            }
            toolCalls.push(call);
          }
        }
      };

      try {
        while (true) {
          throwIfAborted(params.abortSignal);
          const { done, value } = await reader.read();
          if (done) break;

          const decoded = decoder.decode(value, { stream: true });
          logRawLlmStream({
            provider: "openai",
            model,
            iteration: iter,
            label: "sse_chunk",
            payload: decoded,
          });
          rawStreamRecorder?.record({
            iteration: iter,
            label: "sse_chunk",
            payload: decoded,
          });
          buffer += decoded;
          const extracted = extractSseJson(buffer);
          buffer = extracted.rest;
          handleResponseEvents(extracted.events as ResponseStreamEvent[]);
        }
        buffer += decoder.decode();
        const trailing = extractSseJson(buffer, { flush: true });
        handleResponseEvents(trailing.events as ResponseStreamEvent[]);
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // ignore
        }
      }

      if (sawReasoning) callbacks.onReasoningBlockEnd?.();
      throwIfAborted(params.abortSignal);

      if (!toolCalls.length || !runTools) {
        break;
      }

      if (toolCalls.some(shouldAppendCourtlistenerCitationReminder)) {
        needsCourtlistenerCitationReminder = true;
      }

      const results = await runTools(toolCalls);
      throwIfAborted(params.abortSignal);
      input = results.map((result) => ({
        type: "function_call_output" as const,
        call_id: result.tool_use_id,
        output: result.content,
      }));
    }

    await rawStreamRecorder?.flush("completed");
    return { fullText };
  } catch (error) {
    await rawStreamRecorder?.flush("error", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Chat Completions API (OpenAI-compatible: Cerebras, Mantle /v1, vLLM, etc.)
// ---------------------------------------------------------------------------

type ChatStreamChunk = {
  choices?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  error?: { message?: string; code?: string } | null;
};

function buildChatMessages(
  systemPrompt: string,
  messages: LlmMessage[],
  includeReminder: boolean,
): ChatMessage[] {
  const system = responseInstructions(systemPrompt, includeReminder);
  const out: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

async function streamOpenAIChat(
  params: StreamChatParams,
): Promise<StreamChatResult> {
  const {
    model,
    systemPrompt,
    tools = [],
    callbacks = {},
    runTools,
    apiKeys,
  } = params;
  const maxIter = params.maxIterations ?? 10;
  const key = apiKey(apiKeys?.openai);
  const baseUrl = getOpenAIBaseUrl();
  const url = openAIChatCompletionsUrl(baseUrl);
  const chatTools = toChatTools(tools);
  let messages = buildChatMessages(systemPrompt, params.messages, false);
  let fullText = "";
  let needsCourtlistenerCitationReminder = false;
  const rawStreamRecorder = createRawLlmStreamRecorder({
    provider: "openai",
    model,
  });

  try {
    for (let iter = 0; iter < maxIter; iter++) {
      throwIfAborted(params.abortSignal);

      if (needsCourtlistenerCitationReminder) {
        // Rebuild system with citation reminder; keep conversation tail.
        const rest = messages.filter((m) => m.role !== "system");
        messages = [
          {
            role: "system",
            content: responseInstructions(systemPrompt, true),
          },
          ...rest,
        ];
      }

      const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
        max_tokens: MAX_OUTPUT_TOKENS,
      };
      if (chatTools.length) {
        body.tools = chatTools;
        body.tool_choice = "auto";
      }

      const response = await postJson({
        url,
        apiKey: key,
        body,
        signal: params.abortSignal,
      });
      if (!response.body) throw new Error("OpenAI chat response had no body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let contentThisTurn = "";
      let sawReasoning = false;
      // Accumulate streamed tool calls by index
      const toolAcc = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      const startedToolCallIds = new Set<string>();

      const handleChatEvents = (events: ChatStreamChunk[]) => {
        for (const event of events) {
          logRawLlmStream({
            provider: "openai",
            model,
            iteration: iter,
            label: "sse_event",
            payload: event,
          });
          rawStreamRecorder?.record({
            iteration: iter,
            label: "sse_event",
            payload: event,
          });

          if (event.error) {
            const msg =
              typeof event.error.message === "string"
                ? event.error.message
                : "OpenAI chat stream error";
            const code =
              typeof event.error.code === "string" ? event.error.code : null;
            throw new Error(code ? `OpenAI error (${code}): ${msg}` : msg);
          }

          const delta = event.choices?.[0]?.delta;
          if (!delta) continue;

          if (
            typeof delta.reasoning_content === "string" &&
            delta.reasoning_content
          ) {
            sawReasoning = true;
            callbacks.onReasoningDelta?.(delta.reasoning_content);
          }

          if (typeof delta.content === "string" && delta.content) {
            contentThisTurn += delta.content;
            fullText += delta.content;
            callbacks.onContentDelta?.(delta.content);
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const index = typeof tc.index === "number" ? tc.index : 0;
              const acc = toolAcc.get(index) ?? {
                id: "",
                name: "",
                arguments: "",
              };
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (tc.function?.arguments) {
                acc.arguments += tc.function.arguments;
              }
              toolAcc.set(index, acc);

              if (acc.id && !startedToolCallIds.has(acc.id)) {
                startedToolCallIds.add(acc.id);
                callbacks.onToolCallStart?.({
                  id: acc.id,
                  name: acc.name,
                  input: {},
                });
              }
            }
          }
        }
      };

      try {
        while (true) {
          throwIfAborted(params.abortSignal);
          const { done, value } = await reader.read();
          if (done) break;

          const decoded = decoder.decode(value, { stream: true });
          logRawLlmStream({
            provider: "openai",
            model,
            iteration: iter,
            label: "sse_chunk",
            payload: decoded,
          });
          rawStreamRecorder?.record({
            iteration: iter,
            label: "sse_chunk",
            payload: decoded,
          });
          buffer += decoded;
          const extracted = extractSseJson(buffer);
          buffer = extracted.rest;
          handleChatEvents(extracted.events as ChatStreamChunk[]);
        }
        buffer += decoder.decode();
        const trailing = extractSseJson(buffer, { flush: true });
        handleChatEvents(trailing.events as ChatStreamChunk[]);
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // ignore
        }
      }

      if (sawReasoning) callbacks.onReasoningBlockEnd?.();
      throwIfAborted(params.abortSignal);

      const toolCalls: NormalizedToolCall[] = [...toolAcc.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, acc]) => {
          let input: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(acc.arguments || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              input = parsed as Record<string, unknown>;
            }
          } catch {
            input = {};
          }
          return {
            id: acc.id || acc.name || "function_call",
            name: acc.name,
            input,
          };
        })
        .filter((c) => c.name);

      if (!toolCalls.length || !runTools) {
        break;
      }

      if (toolCalls.some(shouldAppendCourtlistenerCitationReminder)) {
        needsCourtlistenerCitationReminder = true;
      }

      // Append assistant tool_calls turn + tool results for next iteration.
      const assistantToolCalls: ChatToolCall[] = toolCalls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: {
          name: c.name,
          arguments: JSON.stringify(c.input ?? {}),
        },
      }));
      messages = [
        ...messages,
        {
          role: "assistant",
          content: contentThisTurn || null,
          tool_calls: assistantToolCalls,
        },
      ];

      const results = await runTools(toolCalls);
      throwIfAborted(params.abortSignal);
      for (const result of results) {
        messages.push({
          role: "tool",
          tool_call_id: result.tool_use_id,
          content: result.content,
        });
      }
    }

    await rawStreamRecorder?.flush("completed");
    return { fullText };
  } catch (error) {
    await rawStreamRecorder?.flush("error", error);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export async function streamOpenAI(
  params: StreamChatParams,
): Promise<StreamChatResult> {
  const mode: OpenAIApiMode = getOpenAIApiMode();
  if (mode === "chat") return streamOpenAIChat(params);
  return streamOpenAIResponses(params);
}

export async function completeOpenAIText(params: {
  model: string;
  systemPrompt?: string;
  user: string;
  maxTokens?: number;
  apiKeys?: { openai?: string | null };
}): Promise<string> {
  const key = apiKey(params.apiKeys?.openai);
  const mode = getOpenAIApiMode();
  const maxTokens = params.maxTokens ?? 512;

  if (mode === "chat") {
    const response = await postJson({
      url: openAIChatCompletionsUrl(),
      apiKey: key,
      body: {
        model: params.model,
        messages: [
          ...(params.systemPrompt
            ? [{ role: "system" as const, content: params.systemPrompt }]
            : []),
          { role: "user" as const, content: params.user },
        ],
        max_tokens: maxTokens,
        stream: false,
      },
    });
    const json = (await response.json()) as {
      choices?: { message?: { content?: string | null } }[];
    };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }

  const response = await createResponse({
    model: params.model,
    instructions: params.systemPrompt,
    input: [{ role: "user", content: params.user }],
    maxTokens,
    apiKey: key,
    stream: false,
  });
  const json = (await response.json()) as {
    output_text?: string;
    output?: {
      content?: { type?: string; text?: string }[];
    }[];
  };

  if (typeof json.output_text === "string") return json.output_text;

  return (
    json.output
      ?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text")
      .map((content) => content.text ?? "")
      .join("") ?? ""
  );
}

export type { NormalizedToolResult };
