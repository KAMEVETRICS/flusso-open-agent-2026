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

export async function completeStructured<T extends z.ZodTypeAny>(
  client: OpenAI,
  options: {
    model: string;
    schema: T;
    name: string;
    instructions: string;
    input: unknown;
    maxTokens: number;
  }
): Promise<z.infer<T>> {
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: options.instructions },
    { role: "user", content: typeof options.input === "string" ? options.input : JSON.stringify(options.input) }
  ];
  const body = {
    model: options.model,
    messages,
    response_format: zodResponseFormat(options.schema, options.name),
    max_tokens: options.maxTokens,
    // OpenRouter routing: only use endpoints that honor response_format and max_tokens.
    provider: { require_parameters: true }
  };

  try {
    const completion = await client.chat.completions.parse(body);
    const message = completion.choices[0]?.message;
    if (message?.refusal) throw new Error("the model refused: " + message.refusal);
    if (!message?.parsed) throw new Error("returned no structured output");
    return options.schema.parse(message.parsed);
  } catch (error) {
    if (error instanceof LengthFinishReasonError) {
      throw new Error("output was cut off at the " + options.maxTokens + "-token limit");
    }
    throw error;
  }
}
