import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";
import { createOpenRouterClient, isOpenRouterConfigured, textModel } from "./openrouter";

// Chooses who answers Flusso's text model calls. Meterless Nightshift is the primary provider: a
// local OpenAI-compatible runtime (Meterless Runtime 0.90 contract) that routes to the fleet the
// machine has, including NVIDIA Nemotron on NVIDIA's hosted endpoints. OpenRouter is the fallback
// when no Nightshift runtime is configured.

// Environment variables, passed in so tests can supply their own.
export type Env = Record<string, string | undefined>;

export const METERLESS_DEFAULT_BASE_URL = "http://127.0.0.1:8088/v1";
// The campaign stages need large structured answers; meterless/auto can route them to a small
// model, so they ask Nightshift for Nemotron 3 Ultra by name unless METERLESS_MODEL says otherwise.
const METERLESS_DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
// The contract asks for at least 180 s; a campaign stage on Nemotron 3 Ultra can run past that,
// so the default is 10 minutes (METERLESS_TIMEOUT_MS overrides it).
const METERLESS_TIMEOUT_MS = 600_000;
// Stable lowercase id the runtime uses to keep this app's requests apart.
export const METERLESS_APP_ID = "flusso";
// The evidence agent runs on Nemotron 3 Ultra, through Nightshift or OpenRouter.
const NEMOTRON_AGENT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

export type TextProvider = {
  id: "meterless" | "openrouter";
  label: string;
  client: OpenAI;
  // Model (or Meterless routing mode) for the campaign pipeline stages.
  model: string;
  // Model for the evidence-planning reasoning agent.
  agentModel: string;
};

// Accepts a pasted URL with or without a scheme, /v1, /v1/chat/completions, /v1/models, or
// /healthz, and returns <host>/v1 without ever producing /v1/v1.
export function normalizeMeterlessBaseUrl(raw: string) {
  const trimmed = raw.trim();
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : "http://" + trimmed;
  const url = new URL(withScheme);
  return url.protocol + "//" + url.host + "/v1";
}

// The runtime token: METERLESS_RUNTIME_TOKEN when set, otherwise the proxy-token file the Windows
// runtime writes to %LOCALAPPDATA%\ai.meterless.runtime, so a local Nightshift needs no copying.
export function meterlessToken(env: Env = process.env) {
  const fromEnv = env.METERLESS_RUNTIME_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  if (!env.LOCALAPPDATA) return "";
  const file = path.join(env.LOCALAPPDATA, "ai.meterless.runtime", "proxy-token");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : "";
}

export function isMeterlessConfigured(env: Env = process.env) {
  const token = meterlessToken(env);
  return Boolean(token && token !== "rt-local");
}

export function meterlessHeaders() {
  return { "meterless-app": METERLESS_APP_ID, "meterless-scope": "user" };
}

export function createMeterlessClient(env: Env = process.env) {
  const token = meterlessToken(env);
  if (!token || token === "rt-local") {
    throw new Error("No Nightshift runtime token: start Nightshift, or copy the token from Setup > Providers into METERLESS_RUNTIME_TOKEN.");
  }
  return new OpenAI({
    apiKey: token,
    baseURL: normalizeMeterlessBaseUrl(env.METERLESS_BASE_URL || METERLESS_DEFAULT_BASE_URL),
    timeout: Number(env.METERLESS_TIMEOUT_MS || METERLESS_TIMEOUT_MS),
    defaultHeaders: meterlessHeaders()
  });
}

export function isTextProviderConfigured() {
  return isMeterlessConfigured() || isOpenRouterConfigured();
}

export function textProvider(env: Env = process.env): TextProvider {
  if (isMeterlessConfigured(env)) {
    const model = env.METERLESS_MODEL?.trim() || METERLESS_DEFAULT_MODEL;
    return {
      id: "meterless",
      label: "Meterless Nightshift",
      client: createMeterlessClient(env),
      model,
      // Pinned to Nemotron 3 Ultra, which Nightshift serves from NVIDIA's endpoints:
      // meterless/auto may route a step to a smaller model.
      agentModel: env.METERLESS_AGENT_MODEL?.trim() || NEMOTRON_AGENT_MODEL
    };
  }
  return {
    id: "openrouter",
    label: "OpenRouter",
    client: createOpenRouterClient(),
    model: textModel(),
    agentModel: env.FLUSSO_AGENT_MODEL?.trim() || NEMOTRON_AGENT_MODEL
  };
}

export type MeterlessStatus = { state: "online" | "unauthorized" | "offline"; models: string[]; detail: string };

// GET /v1/models decides the runtime's state: 401 or 403 is unauthorized, 200 with meterless ids
// is online, and anything else (including an unreachable port) is offline.
export async function probeMeterless(
  env: Env = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<MeterlessStatus> {
  const baseUrl = normalizeMeterlessBaseUrl(env.METERLESS_BASE_URL || METERLESS_DEFAULT_BASE_URL);
  try {
    const response = await fetchImpl(baseUrl + "/models", {
      headers: { Authorization: "Bearer " + meterlessToken(env), ...meterlessHeaders() },
      signal: AbortSignal.timeout(10_000)
    });
    if (response.status === 401 || response.status === 403) {
      return { state: "unauthorized", models: [], detail: "HTTP " + response.status };
    }
    if (!response.ok) return { state: "offline", models: [], detail: "HTTP " + response.status };
    const body = await response.json() as { data?: Array<{ id?: unknown }> };
    const models = (body.data ?? []).map((model) => String(model.id ?? "")).filter(Boolean);
    return models.some((id) => id.startsWith("meterless/"))
      ? { state: "online", models, detail: models.length + " routing modes" }
      : { state: "offline", models, detail: "no meterless/* models listed" };
  } catch (error) {
    return { state: "offline", models: [], detail: error instanceof Error ? error.message : String(error) };
  }
}
