import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { URL } from "node:url";
import { findSampleFixture, isSampleMode, loadSampleFixture, runEvidenceAgent, sampleMatchesInput } from "../lib/agent/run-agent.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

for (const name of readdirSync("samples")) {
  test("sample " + name + " replays its recorded run with no network and the same verdicts", async () => {
    globalThis.fetch = async (url) => {
      throw new Error("sample mode must not call the network: " + url);
    };
    const directory = mkdtempSync(path.join(os.tmpdir(), "flusso-sample-"));
    try {
      const sampleDirectory = path.join("samples", name);
      const discovery = JSON.parse(readFileSync(path.join(sampleDirectory, "discovery.json"), "utf8"));
      const input = JSON.parse(readFileSync(path.join(sampleDirectory, "input.json"), "utf8"));
      const domain = new URL(input.website).hostname.replace(/^www\./, "");
      const run = await runEvidenceAgent(
        { brief: discovery.brief, domain, factSheet: discovery.factSheet, sources: discovery.sources },
        { runId: "test-" + name, sample: loadSampleFixture(sampleDirectory), logDirectory: path.join(directory, "logs"), stateDirectory: path.join(directory, "state") }
      );
      const recorded = JSON.parse(readFileSync(path.join("output_examples", name + ".json"), "utf8")).output;
      assert.equal(run.plan.mode, "sample");
      assert.deepEqual(run.plan.decisions.map((decision) => [decision.id, decision.status]), recorded.decisions.map((decision) => [decision.id, decision.status]));
      assert.ok(run.plan.decisions.some((decision) => decision.status === "accepted"));
      assert.ok(run.plan.models.every((model) => /nemotron/.test(model)));
      const trace = readFileSync(path.join(directory, "logs", "trace.jsonl"), "utf8");
      assert.match(trace, /"event":"decision\.accepted"/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("a recorded run refuses to replay against a different goal or fact sheet", async () => {
  const fixture = loadSampleFixture(path.join("samples", "linear-asks"));
  const { brief, factSheet, sources } = fixture.discovery;
  assert.equal(sampleMatchesInput(fixture, brief.goal, factSheet), true);
  assert.equal(sampleMatchesInput(fixture, "Grow time-tracking signups", factSheet), false);
  const swapped = { ...factSheet, facts: factSheet.facts.map((fact, i) => (i === 0 ? { ...fact, statement: "Linear tracks billable hours." } : fact)) };
  assert.equal(sampleMatchesInput(fixture, brief.goal, swapped), false);
  await assert.rejects(
    runEvidenceAgent({ brief, domain: "linear.app", factSheet: swapped, sources }, { runId: "mismatch", sample: fixture, logDirectory: os.tmpdir() + "/flusso-mismatch-logs", stateDirectory: os.tmpdir() + "/flusso-mismatch-state" }),
    /different goal or fact sheet/
  );
});

test("SAMPLE_MODE is read from the environment, and each fixture is found by its domain", () => {
  assert.equal(isSampleMode({ SAMPLE_MODE: "true" }), true);
  assert.equal(isSampleMode({ SAMPLE_MODE: "false" }), false);
  assert.equal(isSampleMode({}), false);
  assert.equal(findSampleFixture("linear.app")?.directory, path.join("samples", "linear-asks"));
  assert.equal(findSampleFixture("example.org"), null);
});
