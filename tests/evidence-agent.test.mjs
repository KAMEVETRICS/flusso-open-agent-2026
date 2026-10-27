import assert from "node:assert/strict";
import test from "node:test";
import { openBrandMemory } from "../lib/agent/brand-memory-engine.ts";
import { runEvidenceTool } from "../lib/agent/evidence-tools.ts";
import { decisionsForPrompt } from "../lib/agent/prompt.ts";
import { buildEvidenceIndex, planCampaignEvidence, verifyDecision } from "../lib/agent/reasoning-agent.ts";
import { createTracer, memorySink } from "../lib/agent/trace.ts";
import { openWorldModel } from "../lib/agent/world-state.ts";

const factSheet = {
  facts: [
    { id: "fact-1", category: "product", statement: "Asks turns Slack messages into Linear issues.", entity: "", sourceId: "src-site", sectionId: "src-site#asks", quote: "Turn Slack messages into issues", authority: "first-party", timeSensitive: false },
    { id: "fact-2", category: "company", statement: "Linear was founded in 2019.", entity: "", sourceId: "src-site", sectionId: "src-site#about", quote: "Founded in 2019", authority: "first-party", timeSensitive: false }
  ],
  gaps: ["pricing"],
  discoverySteps: [],
  rejectedFacts: 0,
  extractionErrors: [],
  excludedCompetitors: []
};

// Zetaris stand-in keyed by query purpose, recording every statement it receives.
function fakeZetaris(tables, statements = []) {
  return async (sql, options = {}) => {
    statements.push({ sql, purpose: options.purpose });
    const purpose = options.purpose ?? "";
    if (purpose.startsWith("dq:")) {
      return { queryId: "q-" + purpose, sql, headers: [], rows: [{ total_record: "10", valid_record: "9", invalid_record: "1" }], total: 1, timeUsedMs: 1 };
    }
    const tool = purpose.split(":")[0];
    if (purpose.endsWith(":create") || purpose.endsWith(":drop")) return { queryId: "q-" + purpose, sql, headers: [], rows: [], total: 0, timeUsedMs: 1 };
    if (tables[tool] instanceof Error) throw tables[tool];
    const rows = tables[tool] ?? [];
    return { queryId: "q-" + tool, sql, headers: Object.keys(rows[0] ?? {}), rows, total: rows.length, timeUsedMs: 1 };
  };
}

function scriptedGenerator(replies, seen = []) {
  return async (request) => {
    seen.push(request);
    const queue = replies[request.step];
    if (!queue?.length) throw new Error("no scripted reply for " + request.step);
    return { output: request.schema.parse(queue.shift()), model: "nvidia/nemotron-test" };
  };
}

const claimRows = [
  { claim_kind: "capability", status: "supported", claims: "37", repaired: "0" },
  { claim_kind: "capability", status: "unsupported", claims: "3", repaired: "2" }
];

test("the verifier accepts a decision whose citations exist and fit its kind", () => {
  const index = buildEvidenceIndex(
    { facts: [], signals: [], gaps: [], brandEntityId: "b", counts: {} },
    [],
    [{ tool: "claim_risk", queries: [], note: "", rows: [{ id: "claim_risk#2", tool: "claim_risk", queryId: "q1", data: claimRows[1] }] }]
  );
  const result = verifyDecision({
    id: "d1", kind: "claim_policy", confidence: 80,
    statement: "Quote a source for every capability claim.",
    rationale: "3 capability claims failed verification before (claim_risk#2).",
    evidenceIds: ["claim_risk#2"]
  }, index, "");
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.evidenceIds, ["claim_risk#2"]);
});

test("the verifier rejects missing citations, the wrong evidence kind, and invented numbers", () => {
  const index = buildEvidenceIndex(
    { facts: [{ id: "fact:fact-1", category: "product", statement: "Asks turns Slack messages into issues.", quote: "", sourceUrl: "", confidence: 0.9, provenance: "" }], signals: [], gaps: [], brandEntityId: "b", counts: {} },
    [],
    []
  );
  const missing = verifyDecision({ id: "d1", kind: "angle", confidence: 50, statement: "Lead with speed.", rationale: "", evidenceIds: ["claim_risk#9"] }, index, "");
  assert.match(missing.problems[0], /cites no evidence that exists/);

  const wrongKind = verifyDecision({ id: "d2", kind: "channel_priority", confidence: 50, statement: "Post on LinkedIn first.", rationale: "", evidenceIds: ["fact:fact-1"] }, index, "");
  assert.match(wrongKind.problems.join(" "), /channel_priority needs evidence from performance/);

  const invented = verifyDecision({ id: "d3", kind: "angle", confidence: 50, statement: "Say Asks saves 40% of triage time.", rationale: "", evidenceIds: ["fact:fact-1"] }, index, "");
  assert.match(invented.problems.join(" "), /states numbers not in its evidence: 40/);
});

test("the agent plans, queries Zetaris, verifies, and revises a rejected decision once", async () => {
  const records = [];
  const tracer = createTracer("run-1", [memorySink(records)], () => new Date("2026-10-27T00:00:00Z"));
  const statements = [];
  const seen = [];
  const plan = await planCampaignEvidence({
    runId: "run-1",
    mode: "live",
    provider: "test",
    brief: { brand: "Linear", goal: "Get product teams to adopt Asks for Slack requests", audience: "Product leads", platforms: ["LinkedIn"] },
    domain: "linear.app",
    factSheet,
    sourceUrls: { "src-site": "https://linear.app/asks" }
  }, {
    zetaris: fakeZetaris({ claim_risk: claimRows, performance: [] }, statements),
    world: openWorldModel("linear.app"),
    memory: openBrandMemory("linear.app"),
    tracer,
    now: () => new Date("2026-10-27T00:00:00Z"),
    generate: scriptedGenerator({
      plan: [{ hypothesis: "Capability claims need quotes.", calls: [
        { tool: "claim_risk", terms: [], reason: "past claims" },
        { tool: "performance", terms: [], reason: "channels" },
        { tool: "claim_risk", terms: [], reason: "duplicate call is dropped" }
      ] }],
      decide: [{ decisions: [
        { id: "d1", kind: "claim_policy", statement: "Quote the Asks page for every capability claim.", rationale: "3 capability claims failed before.", evidenceIds: ["claim_risk#2"], confidence: 85 },
        { id: "d2", kind: "channel_priority", statement: "Lead on LinkedIn.", rationale: "It performs best.", evidenceIds: ["fact:fact-1"], confidence: 40 }
      ], openQuestions: ["No performance rows exist yet."] }],
      revise: [{ decisions: [
        { id: "d2", kind: "angle", statement: "Lead with turning Slack messages into issues.", rationale: "The Asks page says it.", evidenceIds: ["fact:fact-1"], confidence: 70 }
      ], openQuestions: [] }]
    }, seen)
  });

  assert.deepEqual(plan.decisions.map((decision) => [decision.id, decision.status, decision.revised]), [["d1", "accepted", false], ["d2", "accepted", true]]);
  assert.deepEqual(plan.models, ["nvidia/nemotron-test"]);
  assert.deepEqual(plan.evidence.tools, ["claim_risk", "performance"]);
  assert.deepEqual(plan.dataQuality[0], { rule: "claim_status_known", total: 10, valid: 9, invalid: 1 });
  // The USL is queried with the domain as a quoted literal.
  assert.ok(statements.some(({ sql }) => sql.includes("brand_evidence.claim_outcome") && sql.includes("c.domain = 'linear.app'")));
  // The decide step saw the world facts and the Zetaris rows with their evidence IDs.
  const decideInput = seen.find((request) => request.step === "decide").input;
  assert.ok(decideInput.worldFacts.some((fact) => fact.id === "fact:fact-1"));
  assert.ok(decideInput.toolResults.some((result) => result.rows.some((row) => row.id === "claim_risk#2")));
  const reviseInput = seen.find((request) => request.step === "revise").input;
  assert.match(reviseInput.rejected[0].verifierSays, /channel_priority needs evidence/);
  // Every accepted decision gets a provenance record with its full evidence chain.
  const provenance = records.filter(({ stream }) => stream === "provenance");
  assert.equal(provenance.length, 2);
  assert.equal(provenance[0].record.evidence[0].provenance, "zetaris query q-claim_risk");
  assert.match(decisionsForPrompt(plan), /Quote the Asks page/);
});

test("a failing tool is reported to the model as a failure, not as an empty result", async () => {
  const seen = [];
  const plan = await planCampaignEvidence({
    runId: "run-2", mode: "live", provider: "test",
    brief: { brand: "Linear", goal: "Adopt Asks", audience: "", platforms: [] },
    domain: "linear.app", factSheet, sourceUrls: {}
  }, {
    zetaris: fakeZetaris({ performance: new Error("Zetaris query failed (HTTP 400): no such table") }),
    world: openWorldModel("linear.app"),
    memory: openBrandMemory("linear.app"),
    tracer: createTracer("run-2", []),
    generate: scriptedGenerator({
      plan: [{ hypothesis: "h", calls: [{ tool: "performance", terms: [], reason: "r" }] }],
      decide: [{ decisions: [], openQuestions: ["Performance could not be read."] }]
    }, seen)
  });
  const decideInput = seen.find((request) => request.step === "decide").input;
  assert.match(decideInput.toolResults[0].note, /^FAILED: Zetaris query failed/);
  assert.deepEqual(plan.decisions, []);
});

test("live REST signals run as Zetaris session tables that are dropped even when the read fails", async () => {
  const statements = [];
  const run = async (sql, options) => {
    statements.push(sql);
    if (sql.startsWith("SELECT")) throw new Error("read failed");
    return { queryId: "q", sql, headers: [], rows: [], total: 0, timeUsedMs: 0 };
  };
  await assert.rejects(runEvidenceTool(run, { tool: "audience_signals" }, { domain: "linear.app", brand: "Linear", runTag: "run-9", now: new Date() }), /read failed/);
  assert.match(statements[0], /^CREATE REST SESSION TABLE fl_hn_run9 REQUEST \(endpoint "https:\/\/hn\.algolia\.com\/api\/v1\/search\?query=linear\.app/);
  assert.equal(statements.at(-1), "DROP TABLE session.fl_hn_run9");
});

test("prior_evidence escapes and limits search terms, and skips the query without any", async () => {
  const statements = [];
  const run = async (sql) => {
    statements.push(sql);
    return { queryId: "q", sql, headers: [], rows: [], total: 0, timeUsedMs: 0 };
  };
  const ctx = { domain: "o'brien.com", brand: "O'Brien", runTag: "r", now: new Date() };
  const empty = await runEvidenceTool(run, { tool: "prior_evidence", terms: ["a", ""] }, ctx);
  assert.equal(statements.length, 0);
  assert.match(empty.note, /No usable search terms/);
  await runEvidenceTool(run, { tool: "prior_evidence", terms: ["Slack's", "triage"] }, ctx);
  assert.match(statements[0], /domain = 'o\\'brien\.com'/);
  assert.match(statements[0], /LIKE '%slack s%' OR lower\(excerpt\) LIKE '%triage%'/);
});
