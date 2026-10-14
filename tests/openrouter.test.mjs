/* global Headers, Response */
import assert from "node:assert/strict";
import process from "node:process";
import test, { afterEach, beforeEach } from "node:test";
import { z } from "zod";
import { completeStructured, createOpenRouterClient } from "../lib/openrouter.ts";

const originalFetch = globalThis.fetch;
const Schema = z.object({ brand: z.string(), competitors: z.array(z.string()).max(2) });

function completion(content, finishReason = "stop") {
  return {
    id: "gen-1",
    object: "chat.completion",
    created: 1760400000,
    model: "openai/gpt-5.6-luna",
    choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content, refusal: null } }]
  };
}

function stubFetch(body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return calls;
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = "sk-or-test";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const request = {
  model: "openai/gpt-5.6-luna",
  schema: Schema,
  name: "brief_inference",
  instructions: "Infer the brief.",
  input: { website: "https://arc.house" },
  maxTokens: 4000
};

test("sends a strict structured request through OpenRouter and parses the result", async () => {
  const calls = stubFetch(completion(JSON.stringify({ brand: "Arc House", competitors: ["Circle"] })));

  const output = await completeStructured(createOpenRouterClient(), request);
  assert.deepEqual(output, { brand: "Arc House", competitors: ["Circle"] });

  const [call] = calls;
  assert.equal(call.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(call.headers.get("authorization"), "Bearer sk-or-test");
  assert.equal(call.headers.get("x-title"), "Flusso");
  assert.equal(call.body.model, "openai/gpt-5.6-luna");
  assert.equal(call.body.max_tokens, 4000);
  assert.deepEqual(call.body.provider, { require_parameters: true });
  assert.equal(call.body.response_format.type, "json_schema");
  assert.equal(call.body.response_format.json_schema.name, "brief_inference");
  assert.equal(call.body.response_format.json_schema.strict, true);
  assert.deepEqual(call.body.messages.map((message) => message.role), ["system", "user"]);
  assert.equal(call.body.messages[1].content, JSON.stringify({ website: "https://arc.house" }));
});

test("reports a truncated response with the token limit", async () => {
  stubFetch(completion("{\"brand\": \"Arc", "length"));
  await assert.rejects(completeStructured(createOpenRouterClient(), request), /cut off at the 4000-token limit/);
});

test("rejects output that breaks the schema", async () => {
  stubFetch(completion(JSON.stringify({ brand: "Arc", competitors: ["A", "B", "C"] })));
  await assert.rejects(completeStructured(createOpenRouterClient(), request), /too_big|at most 2/i);
});

test("requires an OpenRouter key", () => {
  delete process.env.OPENROUTER_API_KEY;
  assert.throws(() => createOpenRouterClient(), /OPENROUTER_API_KEY is missing/);
});
