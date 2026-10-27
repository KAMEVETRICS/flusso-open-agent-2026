/* global Response */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { recordingRunner, replayRunner } from "../lib/agent/recorded-zetaris.ts";
import { recordingGenerator, replayGenerator } from "../lib/agent/recorded-generator.ts";
import { DecisionSetSchema } from "../lib/agent/schemas.ts";
import { silentTracer } from "../lib/agent/trace.ts";
import { jdbcFromDatabaseUrl, setupStatements } from "../lib/agent/zetaris-catalog.ts";
import { createZetarisRunner, parseZetarisResponse, zetarisConfigFromEnv } from "../lib/agent/zetaris.ts";
import { isMeterlessConfigured, normalizeMeterlessBaseUrl, probeMeterless, textProvider } from "../lib/model-provider.ts";

const config = { baseUrl: "http://localhost:8888/api/v1.0", orgId: "1", apiKey: "zk-test" };

test("Zetaris rows map headers to string cells", () => {
  const result = parseZetarisResponse("q1", "SELECT 1", { headers: ["domain", "n"], data: [["linear.app", "37"], [null, 2]], total: 2, timeUsed: 12 });
  assert.deepEqual(result.rows, [{ domain: "linear.app", n: "37" }, { domain: null, n: "2" }]);
  assert.equal(result.timeUsedMs, 12);
});

test("the Zetaris runner sends the REST contract headers and retries a federated connection failure", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ msg: "org.postgresql.util.PSQLException: The connection attempt failed." }), { status: 400 });
    }
    return new Response(JSON.stringify({ headers: ["two"], data: [["2"]], total: 1, timeUsed: 5 }), { status: 200 });
  };
  const run = createZetarisRunner(config, silentTracer, fetchImpl, 0);
  const result = await run("SELECT 1+1 AS two", { purpose: "probe" });
  assert.deepEqual(result.rows, [{ two: "2" }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://localhost:8888/api/v1.0/sql-editor/sqls/run");
  assert.equal(calls[0].init.headers.Authorization, "Bearer zk-test");
  assert.equal(calls[0].init.headers["X-Org-ID"], "1");
  assert.match(calls[0].init.headers["X-Request-ID"], /^[0-9a-f-]{36}$/);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.source, "SqlEditor");
  assert.equal(body.sql, "SELECT 1+1 AS two");
});

test("the Zetaris runner does not retry a SQL error", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ msg: "Table or view not found" }), { status: 400 });
  };
  const run = createZetarisRunner(config, silentTracer, fetchImpl, 0);
  await assert.rejects(run("SELECT * FROM missing"), /HTTP 400.*Table or view not found/);
  assert.equal(calls, 1);
});

test("Zetaris is configured only with a REST URL and an API key", () => {
  assert.equal(zetarisConfigFromEnv({ ZETARIS_API_KEY: "k" }), null);
  assert.deepEqual(zetarisConfigFromEnv({ ZETARIS_API_KEY: "k", ZETARIS_REST_URL: "http://localhost:8888/api/v1.0/" }), { baseUrl: "http://localhost:8888/api/v1.0", orgId: "1", apiKey: "k" });
});

test("the setup plan registers Neon over JDBC, builds the USL, and coalesces NOT NULL keys", () => {
  const connection = jdbcFromDatabaseUrl("postgresql://user%40x:p%3Ass@ep-1.neon.tech/neondb?sslmode=require&channel_binding=require");
  assert.deepEqual(connection, { jdbcUrl: "jdbc:postgresql://ep-1.neon.tech:5432/neondb?sslmode=require", username: "user@x", password: "p:ss" });
  const statements = setupStatements({ ...connection, password: "***" });
  assert.match(statements[0], /^CREATE DATASOURCE flusso_neon .*jdbcdriver "org\.postgresql\.Driver"/s);
  assert.ok(statements.some((sql) => sql.startsWith("COMPILE USL brand_evidence DEPLOY NAMESPACE lightning.metastore.flusso DDL\nCREATE TABLE campaign (")));
  assert.ok(statements.some((sql) => sql.startsWith("ACTIVATE USL TABLE lightning.metastore.flusso.brand_evidence.campaign AS SELECT COALESCE(campaign_id, '') AS campaign_id, brand,")));
  assert.ok(statements.some((sql) => sql.startsWith("REGISTER DQ claim_status_known TABLE lightning.metastore.flusso.brand_evidence.claim_outcome AS")));
  assert.ok(statements.indexOf("CREATE NAMESPACE IF NOT EXISTS lightning.metastore") < statements.indexOf("CREATE NAMESPACE IF NOT EXISTS lightning.metastore.flusso"));
});

test("a pasted Nightshift URL normalises to <host>/v1", () => {
  for (const pasted of ["127.0.0.1:8088", "http://127.0.0.1:8088/v1", "http://127.0.0.1:8088/v1/chat/completions", "http://127.0.0.1:8088/v1/models", "http://127.0.0.1:8088/healthz"]) {
    assert.equal(normalizeMeterlessBaseUrl(pasted), "http://127.0.0.1:8088/v1");
  }
});

test("Nightshift is the primary text provider when its runtime is configured", () => {
  const meterless = textProvider({ METERLESS_BASE_URL: "http://127.0.0.1:8088", METERLESS_RUNTIME_TOKEN: "rt-abc", OPENROUTER_API_KEY: "or" });
  assert.equal(meterless.id, "meterless");
  assert.equal(meterless.model, "meterless/auto");
  assert.equal(meterless.client.baseURL, "http://127.0.0.1:8088/v1");
  // The placeholder token is rejected, so Nightshift does not count as configured.
  assert.equal(isMeterlessConfigured({ METERLESS_RUNTIME_TOKEN: "rt-local" }), false);
});

test("without METERLESS_RUNTIME_TOKEN, Flusso reads the token file the Windows runtime writes", () => {
  const localAppData = mkdtempSync(path.join(os.tmpdir(), "flusso-ns-"));
  try {
    assert.equal(isMeterlessConfigured({ LOCALAPPDATA: localAppData }), false);
    mkdirSync(path.join(localAppData, "ai.meterless.runtime"));
    writeFileSync(path.join(localAppData, "ai.meterless.runtime", "proxy-token"), "rt-from-file\n");
    const provider = textProvider({ LOCALAPPDATA: localAppData });
    assert.equal(provider.id, "meterless");
    assert.equal(provider.client.apiKey, "rt-from-file");
    assert.equal(provider.client.baseURL, "http://127.0.0.1:8088/v1");
  } finally {
    rmSync(localAppData, { recursive: true, force: true });
  }
});

test("the Nightshift probe tells online, unauthorized, and offline apart", async () => {
  const env = { METERLESS_BASE_URL: "http://127.0.0.1:8088/v1", METERLESS_RUNTIME_TOKEN: "rt-abc" };
  const respond = (status, body) => async (url, init) => {
    assert.equal(url, "http://127.0.0.1:8088/v1/models");
    assert.equal(init.headers.Authorization, "Bearer rt-abc");
    assert.equal(init.headers["meterless-app"], "flusso");
    return new Response(JSON.stringify(body), { status });
  };
  assert.equal((await probeMeterless(env, respond(200, { data: [{ id: "meterless/auto" }, { id: "meterless/deep" }] }))).state, "online");
  assert.equal((await probeMeterless(env, respond(401, {}))).state, "unauthorized");
  assert.equal((await probeMeterless(env, respond(200, { data: [{ id: "gpt-x" }] }))).state, "offline");
  assert.equal((await probeMeterless(env, async () => { throw new Error("ECONNREFUSED"); })).state, "offline");
});

test("recorded Zetaris rows and model replies replay in order without a network", async () => {
  const recording = {};
  let n = 0;
  const live = async (sql) => ({ queryId: "live-" + (n += 1), sql, headers: ["n"], rows: [{ n: String(n) }], total: 1, timeUsedMs: 1 });
  const recorder = recordingRunner(live, recording);
  await recorder("SELECT a", { purpose: "claim_risk:x.com" });
  await recorder("SELECT b", { purpose: "claim_risk:x.com" });
  const replay = replayRunner(recording);
  assert.deepEqual((await replay("other sql", { purpose: "claim_risk:x.com" })).rows, [{ n: "1" }]);
  assert.deepEqual((await replay("other sql", { purpose: "claim_risk:x.com" })).rows, [{ n: "2" }]);
  await assert.rejects(replay("x", { purpose: "claim_risk:x.com" }), /no recorded Zetaris response for claim_risk:x\.com \(call 3\)/);

  const models = { provider: "", steps: {} };
  const reply = { decisions: [], openQuestions: ["q"] };
  const generator = recordingGenerator(async () => ({ output: reply, model: "nvidia/nemotron-3-ultra-550b-a55b" }), models, "Meterless Nightshift");
  await generator({ step: "decide", schema: DecisionSetSchema, instructions: "", input: {}, maxTokens: 1 });
  assert.equal(models.provider, "Meterless Nightshift");
  const replayed = await replayGenerator(models, silentTracer)({ step: "decide", schema: DecisionSetSchema, instructions: "", input: {}, maxTokens: 1 });
  assert.deepEqual(replayed, { output: reply, model: "nvidia/nemotron-3-ultra-550b-a55b" });
});
