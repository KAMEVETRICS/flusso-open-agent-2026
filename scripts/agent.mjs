/* global console */
// Usage: npm run agent -- samples/allbirds-newsletter            (live: Zetaris + Nightshift)
//        npm run agent:sample -- samples/allbirds-newsletter     (replays the recorded run;
//                                                                  same as SAMPLE_MODE=true)
//        npm run agent -- samples/allbirds-newsletter --record   (live run, saved as the sample)
// Runs the evidence-planning agent on one sample input and writes its plan to
// output_examples/<sample>.json. Traces go to stdout and logs/ (audit, trace, telemetry,
// provenance JSONL, plus logs/runs/<run id>/).
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { neon } from "@neondatabase/serverless";
import { STATE_DIRECTORY, isSampleMode, loadSampleFixture, runEvidenceAgent } from "../lib/agent/run-agent.ts";
import { stdoutSink } from "../lib/agent/trace.ts";
import { brandDomain } from "../lib/brand-model.ts";
import { DeliveryPackSchema } from "../lib/schemas.ts";

const args = process.argv.slice(2);
const sampleDirectory = args.find((arg) => !arg.startsWith("--"));
if (!sampleDirectory || !existsSync(path.join(sampleDirectory, "input.json"))) {
  console.error("Usage: npm run agent -- <sample directory with input.json> [--sample | --record]");
  process.exit(64);
}
const record = args.includes("--record");
// --sample does what SAMPLE_MODE=true does, without setting an environment variable.
const sample = isSampleMode() || args.includes("--sample");
if (record && sample) {
  console.error("--record needs a live run; unset SAMPLE_MODE.");
  process.exit(64);
}

const input = JSON.parse(readFileSync(path.join(sampleDirectory, "input.json"), "utf8"));
const domain = brandDomain(input.website);
const runId = (sample ? "sample-" : "live-") + path.basename(sampleDirectory) + "-" + randomUUID().slice(0, 8);

// The agent plans from the brand's verified fact sheet. A live run reads the latest campaign
// Flusso stored for this domain; sample mode reads the copy saved next to the input.
async function loadDiscovery() {
  const saved = path.join(sampleDirectory, "discovery.json");
  if (sample) return JSON.parse(readFileSync(saved, "utf8"));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for a live run.");
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql.query(
    "SELECT id, delivery_pack FROM campaign_runs WHERE delivery_pack->'brief'->>'website' ILIKE $1 " +
    "AND jsonb_array_length(COALESCE(delivery_pack->'factSheet'->'facts', '[]'::jsonb)) > 0 ORDER BY created_at DESC LIMIT 1",
    ["%" + domain + "%"]
  );
  if (!rows[0]) throw new Error("No stored campaign with a fact sheet for " + domain + ". Run a campaign for it in the app first.");
  const pack = DeliveryPackSchema.parse(rows[0].delivery_pack);
  const discovery = {
    fromCampaign: rows[0].id,
    brief: { ...pack.brief, goal: input.goal, audience: input.audience ?? pack.brief.audience },
    factSheet: pack.factSheet,
    sources: pack.sources.map(({ id, title, url, sourceType, authority }) => ({ id, title, url, sourceType, authority }))
  };
  if (record) writeFileSync(saved, JSON.stringify(discovery, null, 2) + "\n");
  return discovery;
}

const started = Date.now();
try {
  const discovery = await loadDiscovery();
  console.log("[INFO] run_id=" + runId + " mode=" + (sample ? "sample" : "live") + " domain=" + domain + " facts=" + discovery.factSheet.facts.length +
    (discovery.fromCampaign ? " fact sheet from campaign " + discovery.fromCampaign : ""));
  const recording = record ? { zetaris: {}, model: { provider: "", steps: {} } } : undefined;
  // A recording keeps the brand's memory as it was before the run, so the replay recalls the same
  // memories the live run did.
  const liveMemory = path.join(STATE_DIRECTORY, "hmem", domain);
  if (record) {
    rmSync(path.join(sampleDirectory, "hmem"), { recursive: true, force: true });
    if (existsSync(liveMemory)) cpSync(liveMemory, path.join(sampleDirectory, "hmem"), { recursive: true });
  }
  const run = await runEvidenceAgent(
    { brief: discovery.brief, domain, factSheet: discovery.factSheet, sources: discovery.sources },
    { runId, sample: sample ? loadSampleFixture(sampleDirectory) : null, record: recording, extraSinks: [stdoutSink()] }
  );
  if (recording) {
    writeFileSync(path.join(sampleDirectory, "zetaris.json"), JSON.stringify(recording.zetaris, null, 2) + "\n");
    writeFileSync(path.join(sampleDirectory, "model.json"), JSON.stringify(recording.model, null, 2) + "\n");
  }
  mkdirSync("output_examples", { recursive: true });
  const output = {
    run_id: runId,
    status: "success",
    input,
    output: run.plan,
    trace_dir: "logs/runs/" + runId,
    execution_time_seconds: Number(((Date.now() - started) / 1000).toFixed(1))
  };
  const outputFile = path.join("output_examples", path.basename(sampleDirectory) + (sample ? ".sample" : "") + ".json");
  writeFileSync(outputFile, JSON.stringify(output, null, 2) + "\n");
  const accepted = run.plan.decisions.filter((decision) => decision.status === "accepted");
  console.log("[INFO] run_id=" + runId + " " + accepted.length + " accepted, " + (run.plan.decisions.length - accepted.length) +
    " rejected decisions; models: " + run.plan.models.join(", ") + "; wrote " + outputFile);
  for (const decision of accepted) console.log("  - [" + decision.kind + "] " + decision.statement + "  <= " + decision.evidenceIds.join(", "));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ run_id: runId, status: "error", error: { type: error?.name ?? "Error", message }, execution_time_seconds: (Date.now() - started) / 1000 }));
  process.exit(1);
}
