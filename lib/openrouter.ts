import process from "node:process";
import OpenAI from "openai";
import { LengthFinishReasonError } from "openai/error";
import { zodResponseFormat } from "openai/helpers/zod";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { z } from "zod";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TEXT_MODEL = "openai/gpt-5.6-luna";
const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2";
const DEFAULT_TIMEOUT_MS = 300_000;
// Sent with every request so usage is attributed to Flusso in the OpenRouter dashboard.
const APP_TITLE = "Flusso";

export function isOpenRouterConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY?.trim());
}

export function openRouterApiKey() {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is missing. Add it to .env.local and restart the server.");
  }
  return key;
}

export function textModel() {
  return process.env.OPENROUTER_MODEL?.trim() || DEFAULT_TEXT_MODEL;
}

export function imageModel() {
  return process.env.OPENROUTER_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
}

export function appHeaders() {
  return { "X-Title": APP_TITLE };
}

export function createOpenRouterClient() {
  return new OpenAI({
    apiKey: openRouterApiKey(),
    baseURL: OPENROUTER_BASE_URL,
    timeout: Number(process.env.OPENROUTER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    defaultHeaders: appHeaders()
  });
}

// The model stopped at the token limit, so its JSON is incomplete.
export class OutputTruncatedError extends Error {
  readonly maxTokens: number;

  constructor(maxTokens: number) {
    super("output was cut off at the " + maxTokens + "-token limit");
    this.name = "OutputTruncatedError";
    this.maxTokens = maxTokens;
  }
}

export async function completeStructured<T extends z.ZodTypeAny>(
  client: OpenAI,
  options: {
    model: string;
    schema: T;
    name: string;
    // Identical leading context across calls; placed first so the provider can cache it.
    context?: string;
    instructions: string;
    input: unknown;
    maxTokens: number;
    // For reasoning models: how long to think before answering. Nemotron at high effort can
    // think through the whole token budget on a large structured answer.
    reasoningEffort?: "low" | "medium" | "high";
    // Called with the model that actually answered; a routing mode such as meterless/auto
    // resolves to a concrete model only in the response.
    onCompletion?: (info: { model: string; promptTokens: number; completionTokens: number }) => void;
  }
): Promise<z.infer<T>> {
  const messages: ChatCompletionMessageParam[] = [
    ...(options.context ? [{ role: "system" as const, content: options.context }] : []),
    { role: "system", content: options.instructions },
    { role: "user", content: typeof options.input === "string" ? options.input : JSON.stringify(options.input) }
  ];
  const viaOpenRouter = client.baseURL.startsWith(OPENROUTER_BASE_URL);
  // Nemotron at its default effort can think through the whole budget on a large structured
  // answer, so it runs at low effort unless the caller asks otherwise.
  const effort = options.reasoningEffort ?? (/nemotron/i.test(options.model) ? "low" : undefined);
  const body = {
    model: options.model,
    messages,
    response_format: zodResponseFormat(options.schema, options.name),
    max_tokens: options.maxTokens,
    // OpenRouter routing: only use endpoints that honor response_format and max_tokens.
    ...(viaOpenRouter ? { provider: { require_parameters: true } } : {}),
    // OpenRouter takes a reasoning object; other OpenAI-compatible runtimes take reasoning_effort.
    ...(effort ? (viaOpenRouter ? { reasoning: { effort } } : { reasoning_effort: effort }) : {})
  };

  try {
    const completion = await client.chat.completions.parse(body);
    options.onCompletion?.({
      model: completion.model || options.model,
      promptTokens: completion.usage?.prompt_tokens ?? 0,
      completionTokens: completion.usage?.completion_tokens ?? 0
    });
    const message = completion.choices[0]?.message;
    if (message?.refusal) throw new Error("the model refused: " + message.refusal);
    if (!message?.parsed) throw new Error("returned no structured output");
    return options.schema.parse(message.parsed);
  } catch (error) {
    if (error instanceof LengthFinishReasonError) throw new OutputTruncatedError(options.maxTokens);
    throw error;
  }
}
