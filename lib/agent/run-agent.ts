import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { ProjectBrief, FactSheet, SourceDocument } from "../schemas";
import { textProvider } from "../model-provider";
import type { Env } from "../model-provider";
import { openBrandMemory, rememberCampaignOutcome } from "./brand-memory-engine";
import { providerGenerator } from "./generator";
import { planCampaignEvidence } from "./reasoning-agent";
import type { Generator } from "./reasoning-agent";
import { recordingRunner, replayRunner } from "./recorded-zetaris";
import type { ZetarisRecording } from "./recorded-zetaris";
import { replayGenerator, recordingGenerator } from "./recorded-generator";
import type { ModelRecording } from "./recorded-generator";
import type { AgentPlan } from "./schemas";
import { createTracer, jsonlSink } from "./trace";
import type { TraceSink, Tracer } from "./trace";
import { openWorldModel } from "./world-state";
import { createZetarisRunner, zetarisConfigFromEnv } from "./zetaris";
import type { ZetarisRunner } from "./zetaris";

// Wires the evidence agent to its engines and adapters. Live mode reads Zetaris and calls the
// configured model provider (Meterless Nightshift first). Sample mode (SAMPLE_MODE=true) replays
// Zetaris rows and model replies recorded from a live run, so it needs no credentials or network,
// while the World Model, H-MEM, and the code-side verifier still run for real.

export const STATE_DIRECTORY = ".flusso";
export const LOG_DIRECTORY = "logs";

export function isSampleMode(env: Env = process.env) {
  return env.SAMPLE_MODE?.trim().toLowerCase() === "true";
}

export type SampleFixture = {
  directory: string;
  zetaris: ZetarisRecording;
  model: ModelRecording;
};

export function loadSampleFixture(directory: string): SampleFixture {
  const read = (file: string) => JSON.parse(readFileSync(path.join(directory, file), "utf8"));
  return { directory, zetaris: read("zetaris.json"), model: read("model.json") };
}

// The recorded sample whose input is for this domain, if one ships in samples/.
export function findSampleFixture(domain: string, root = "samples"): SampleFixture | null {
  if (!existsSync(root)) return null;
  for (const name of readdirSync(root)) {
    const directory = path.join(root, name);
    const inputFile = path.join(directory, "input.json");
    if (!existsSync(inputFile) || !existsSync(path.join(directory, "model.json"))) continue;
    const website = String(JSON.parse(readFileSync(inputFile, "utf8")).website ?? "");
    if (website && new URL(website).hostname.replace(/^www\./, "") === domain) return loadSampleFixture(directory);
  }
  return null;
}

export type AgentRun = {
  plan: AgentPlan;
  tracer: Tracer;
  // Folds the finished campaign back into H-MEM so the next campaign for this domain recalls it.
  remember: (campaignId: string, pack: Parameters<typeof rememberCampaignOutcome>[1]["pack"]) => void;
};

export type AgentRunOptions = {
  runId: string;
  sample?: SampleFixture | null;
  // Record live Zetaris rows and model replies into these objects (to build a sample fixture).
  record?: { zetaris: ZetarisRecording; model: ModelRecording };
  logDirectory?: string;
  stateDirectory?: string;
  extraSinks?: TraceSink[];
};

export function sourceUrlMap(sources: SourceDocument[]) {
  return Object.fromEntries(sources.map((source) => [source.id, source.url ?? ""]));
}

export async function runEvidenceAgent(
  input: { brief: ProjectBrief; domain: string; factSheet: FactSheet; sources: SourceDocument[] },
  options: AgentRunOptions
): Promise<AgentRun> {
  const logDirectory = options.logDirectory ?? LOG_DIRECTORY;
  const stateDirectory = options.stateDirectory ?? STATE_DIRECTORY;
  const tracer = createTracer(options.runId, [jsonlSink(logDirectory), jsonlSink(path.join(logDirectory, "runs", options.runId)), ...(options.extraSinks ?? [])]);
  const sample = options.sample ?? null;

  let zetaris: ZetarisRunner;
  let generate: Generator;
  let provider: string;
  let memoryDirectory: string;
  if (sample) {
    zetaris = replayRunner(sample.zetaris, tracer);
    generate = replayGenerator(sample.model, tracer);
    provider = "sample (recorded " + (sample.model.provider || "live") + " run)";
    // Each sample run starts from the fixture's memory, so it is repeatable.
    memoryDirectory = path.join(stateDirectory, "sample-hmem", options.runId);
    const fixtureMemory = path.join(sample.directory, "hmem");
    if (existsSync(fixtureMemory)) cpSync(fixtureMemory, path.join(memoryDirectory, input.domain), { recursive: true });
  } else {
    const config = zetarisConfigFromEnv();
    if (!config) throw new Error("ZETARIS_REST_URL and ZETARIS_API_KEY are required for a live agent run. Set SAMPLE_MODE=true to replay a recorded run.");
    const textModels = textProvider();
    zetaris = createZetarisRunner(config, tracer);
    generate = providerGenerator(textModels, tracer);
    provider = textModels.label;
    memoryDirectory = path.join(stateDirectory, "hmem");
    if (options.record) {
      zetaris = recordingRunner(zetaris, options.record.zetaris);
      generate = recordingGenerator(generate, options.record.model, textModels.label);
    }
  }
  mkdirSync(memoryDirectory, { recursive: true });

  const memory = openBrandMemory(input.domain, memoryDirectory);
  // World state is built fresh for each run. Fact IDs (fact-3) are unique only within one fact
  // sheet, so a world carried over from an earlier run would let a citation resolve to an older
  // sheet's fact. What should carry across campaigns lives in H-MEM.
  const world = openWorldModel(input.domain);
  const plan = await planCampaignEvidence({
    runId: options.runId,
    mode: sample ? "sample" : "live",
    provider,
    brief: { brand: input.brief.brand, goal: input.brief.goal, audience: input.brief.audience, platforms: input.brief.platforms },
    domain: input.domain,
    factSheet: input.factSheet,
    sourceUrls: sourceUrlMap(input.sources)
  }, { generate, zetaris, world, memory, tracer });

  return {
    plan,
    tracer,
    remember: (campaignId, pack) => {
      rememberCampaignOutcome(memory, { campaignId, pack, plan, learnedAt: Date.now() }, tracer);
      if (sample) rmSync(memoryDirectory, { recursive: true, force: true });
    }
  };
}
