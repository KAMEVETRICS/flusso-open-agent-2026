import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openBrandMemory, recallForCampaign, rememberCampaignOutcome } from "../lib/agent/brand-memory-engine.ts";
import { createTracer, memorySink } from "../lib/agent/trace.ts";
import { buildWorldContext, ingestFactSheet, ingestSignals, openWorldModel } from "../lib/agent/world-state.ts";

const tracer = createTracer("engines", []);

function claim(id, kind, status, text) {
  return { id, text, contentUsedIn: "asset-1", claimKind: kind, evidence: [], checkedAt: "", confidence: 50, status, recommendation: "Cite the pricing page or remove it.", resolutionStatus: "unresolved", repairAction: null, repairNote: "", repairedAt: null };
}

const pack = {
  brief: { goal: "Get freelancers to open a Wise account" },
  editorialReport: { score: 91 },
  proofReport: {
    checkedClaims: 3,
    supported: 2,
    claims: [
      claim("claim-1", "capability", "supported", "Wise holds 40+ currencies."),
      claim("claim-2", "statistic", "unsupported", "Freelancers save 8x on fees with Wise.")
    ]
  }
};

const plan = {
  runId: "run-1",
  decisions: [
    { id: "d1", kind: "claim_policy", statement: "Do not quote fee multiples.", rationale: "", evidenceIds: ["claim_risk#1", "mem-1"], confidence: 80, status: "accepted", verification: "", revised: false },
    { id: "d2", kind: "angle", statement: "Rejected idea.", rationale: "", evidenceIds: [], confidence: 10, status: "rejected", verification: "no evidence", revised: false }
  ]
};

test("H-MEM learns failed claims, the outcome, and accepted decisions, and a later goal recalls them", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "flusso-hmem-"));
  try {
    const memory = openBrandMemory("wise.com", directory, () => 1_790_000_000_000);
    const prior = memory.add({ content: "Fee comparisons for Wise need a dated source.", source: "test", tags: ["claim-risk"] });
    assert.equal(prior.id, "mem-1");
    const records = [];
    const written = rememberCampaignOutcome(memory, { campaignId: "c-1", pack, plan, learnedAt: 1_790_000_000_000 }, createTracer("r", [memorySink(records)]));

    assert.deepEqual(written.map((record) => record.tags[0]), ["claim-risk", "campaign-outcome", "decision"]);
    assert.match(written[0].content, /A statistic claim failed verification \(unsupported\) in campaign c-1: "Freelancers save 8x/);
    assert.equal(written[0].provenance.origin, "plan_completion");
    assert.deepEqual(written[2].derivedFrom, ["mem-1"]);
    // The memory a decision cited loses trust because the campaign still had a failing claim.
    assert.ok(memory.ledger.history("mem-1").some((entry) => entry.action === "feedback"));
    assert.equal(records.find(({ record }) => record.event === "remember.campaign").record.feedback[0], "mem-1");

    // A fresh process on the same directory recalls the lesson for a related goal.
    const reopened = openBrandMemory("wise.com", directory);
    const recalled = recallForCampaign(reopened, "Get freelancers to open a Wise account and compare fees", tracer);
    assert.ok(recalled.some((item) => /Freelancers save 8x/.test(item.content)));
    assert.ok(existsSync(path.join(directory, "wise.com", "ledger.jsonl")));
    assert.match(readFileSync(path.join(directory, "wise.com", "ledger.jsonl"), "utf8"), /"action":"read"/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the World Model holds the fact sheet with provenance and builds goal-ranked context", async () => {
  const world = openWorldModel("linear.app");
  const factSheet = {
    facts: [
      { id: "fact-1", category: "company", statement: "Linear is based in San Francisco.", entity: "", sourceId: "src-a", sectionId: "src-a#about", quote: "based in San Francisco", authority: "first-party", timeSensitive: false },
      { id: "fact-2", category: "product", statement: "Asks turns Slack requests into issues.", entity: "", sourceId: "src-b", sectionId: "src-b#asks", quote: "Slack requests into issues", authority: "first-party", timeSensitive: false },
      { id: "fact-3", category: "competitor", statement: "Teams compare Linear with Jira.", entity: "Jira", sourceId: "src-c", sectionId: "src-c#vs", quote: "Linear vs Jira", authority: "third-party", timeSensitive: false }
    ],
    gaps: ["pricing"], discoverySteps: [], rejectedFacts: 0, extractionErrors: [], excludedCompetitors: []
  };
  const { brandEntityId } = await ingestFactSheet(world, {
    brand: "Linear", domain: "linear.app", factSheet,
    sourceUrls: { "src-b": "https://linear.app/asks" },
    observedAt: "2026-10-27T00:00:00.000Z", runId: "r1"
  }, tracer);
  await ingestSignals(world, brandEntityId, [
    { id: "audience_signals#1", tool: "audience_signals", queryId: "q-hn", data: { title: "Linear Asks launch", points: "120", num_comments: "40", created: "2026-09-01", url: "https://linear.app/changelog/asks" } },
    { id: "attention_trend#1", tool: "attention_trend", queryId: "q-wiki", data: { month: "202609", views: "5000" } }
  ], "2026-10-27T00:00:00.000Z", "r1", tracer);

  const context = buildWorldContext(world, brandEntityId, "Get product teams to adopt Asks for Slack requests");
  assert.equal(context.facts[0].id, "fact:fact-2");
  assert.equal(context.facts[0].sourceUrl, "https://linear.app/asks");
  assert.match(context.facts[0].provenance, /^file flusso-fact-sheet/);
  assert.deepEqual(context.gaps, ["pricing"]);
  assert.ok(context.signals.some((signal) => signal.id === "audience_signals#1" && signal.provenance === "zetaris query q-hn"));
  assert.ok(context.signals.some((signal) => signal.kind === "attention" && /5000/.test(signal.summary)));
  // The competitor became its own entity with a relationship to the brand.
  assert.ok(context.counts.relationships >= 2);
  assert.ok(world.audit().some((entry) => entry.kind === "assertFact" && entry.runId === "r1"));
});
