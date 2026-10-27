import { WorldModel } from "../../vendor/meterless/world-model/index";
import type { Fact } from "../../vendor/meterless/world-model/index";
import type { BrandFact, FactSheet } from "../schemas";
import type { EvidenceRow } from "./evidence-tools";
import type { Tracer } from "./trace";

// Meterless World Model engine, mounted as the campaign's shared world state. The verified brand
// fact sheet (first-party, quote-checked) and the live signals the agent pulls through Zetaris
// land in one event-sourced model with provenance on every write. The context builder
// (AGENTS.md section 8.2) then picks the facts relevant to the campaign goal for the planner.

export type WorldContextFact = {
  id: string;
  category: string;
  statement: string;
  quote: string;
  sourceUrl: string;
  confidence: number;
  provenance: string;
};

export type WorldContext = {
  brandEntityId: string;
  facts: WorldContextFact[];
  gaps: string[];
  signals: Array<{ id: string; kind: string; summary: string; provenance: string }>;
  counts: { entities: number; facts: number; relationships: number; events: number };
};

const STOPWORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "into", "their", "your", "our", "get", "more", "who", "are"]);

function tokens(text: string) {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !STOPWORDS.has(word)));
}

// Proof and product facts carry campaign claims, so they rank ahead of company background.
const CATEGORY_WEIGHT: Record<string, number> = { proof: 3, product: 2.5, audience: 2, pricing: 1.5, competitor: 1, company: 0.5 };

export function openWorldModel(domain: string, directory?: string) {
  return new WorldModel({
    namespace: "flusso-" + domain.replace(/[^a-z0-9.-]/gi, "_"),
    storage: directory ? "local" : "memory",
    directory,
    conflictPolicy: "highest-confidence-wins"
  });
}

export async function ingestFactSheet(
  world: WorldModel,
  input: { brand: string; domain: string; factSheet: FactSheet; sourceUrls: Record<string, string>; observedAt: string; runId: string },
  tracer: Tracer
) {
  const brand = await world.upsertEntity({
    type: "brand",
    externalKey: { system: "domain", id: input.domain },
    name: input.brand,
    attrs: { domain: input.domain },
    source: { kind: "pipeline", by: "flusso-discovery", at: input.observedAt, runId: input.runId }
  });
  const factIds: Record<string, string> = {};
  for (const fact of input.factSheet.facts) {
    const stored = await world.assertFact({
      about: brand.id,
      predicate: fact.category + ":" + fact.id,
      value: { statement: fact.statement, quote: fact.quote, sectionId: fact.sectionId, entity: fact.entity, timeSensitive: fact.timeSensitive },
      // First-party pages are the brand's own word; third-party pages corroborate.
      confidence: fact.authority === "first-party" ? 0.9 : 0.7,
      source: {
        kind: "file",
        by: "flusso-fact-sheet",
        at: input.observedAt,
        url: input.sourceUrls[fact.sourceId] || fact.sourceId,
        runId: input.runId
      }
    });
    factIds[fact.id] = stored.id;
    if (fact.entity && fact.category === "competitor") {
      const rival = await world.upsertEntity({
        type: "company",
        name: fact.entity,
        source: { kind: "file", by: "flusso-fact-sheet", at: input.observedAt, runId: input.runId }
      });
      await world.relate({ from: brand.id, type: "competes_with", to: rival.id, source: { kind: "file", at: input.observedAt, runId: input.runId } });
    }
  }
  for (const gap of input.factSheet.gaps) {
    await world.assertFact({
      about: brand.id,
      predicate: "gap:" + gap,
      value: "no verified fact",
      confidence: 1,
      source: { kind: "pipeline", by: "flusso-fact-sheet", at: input.observedAt, runId: input.runId }
    });
  }
  tracer.write("audit", "world-model", "ingest.fact-sheet", {
    brandEntityId: brand.id,
    facts: input.factSheet.facts.length,
    gaps: input.factSheet.gaps
  });
  return { brandEntityId: brand.id, factIds };
}

// Live signals pulled through Zetaris become world state too, with the Zetaris query ID as their
// provenance checksum, so a decision can trace a signal back to the exact query.
export async function ingestSignals(world: WorldModel, brandEntityId: string, rows: EvidenceRow[], observedAt: string, runId: string, tracer: Tracer) {
  let written = 0;
  for (const row of rows) {
    if (row.tool === "audience_signals" && row.data.title) {
      const story = await world.upsertEntity({
        type: "conversation",
        externalKey: { system: "hn", id: row.data.url ?? row.data.title },
        name: row.data.title,
        attrs: { points: Number(row.data.points ?? 0), comments: Number(row.data.num_comments ?? 0), created: row.data.created, evidenceId: row.id },
        source: { kind: "api", by: "zetaris:hn", at: observedAt, url: row.data.url ?? undefined, checksum: row.queryId, runId }
      });
      await world.relate({ from: story.id, type: "discusses", to: brandEntityId, source: { kind: "api", at: observedAt, checksum: row.queryId, runId } });
      written += 1;
    }
    if (row.tool === "attention_trend" && row.data.month) {
      await world.assertFact({
        about: brandEntityId,
        predicate: "attention:wikipedia_views:" + row.data.month,
        value: Number(row.data.views ?? 0),
        confidence: 1,
        source: { kind: "api", by: "zetaris:wikimedia", at: observedAt, checksum: row.queryId, runId }
      });
      written += 1;
    }
  }
  if (written) tracer.write("audit", "world-model", "ingest.signals", { brandEntityId, written });
  return written;
}

function factStatement(fact: Fact) {
  const value = fact.value as Partial<BrandFact> | string | number;
  return typeof value === "object" && value ? value : { statement: String(value), quote: "" };
}

// Context builder: intent in, structured payload out. Facts rank by overlap with the goal and
// audience, then by category weight, then by confidence, and the list is cut to a budget.
export function buildWorldContext(world: WorldModel, brandEntityId: string, intent: string, budget = 24): WorldContext {
  const facts = world.view("facts") as { about(id: string): Fact[] };
  const graph = world.view("graph") as { incoming(id: string, opts?: { via?: string }): Array<{ id: string; name?: string; attrs: Record<string, unknown>; source: { checksum?: string } }> };
  const current = facts.about(brandEntityId).filter((fact) => !fact.supersededBy);
  const intentTokens = tokens(intent);
  const scored = current
    .filter((fact) => !fact.predicate.startsWith("gap:") && !fact.predicate.startsWith("attention:"))
    .map((fact) => {
      const value = factStatement(fact);
      const category = fact.predicate.split(":")[0];
      const overlap = [...tokens(String(value.statement ?? ""))].filter((word) => intentTokens.has(word)).length;
      return { fact, value, category, score: overlap * 2 + (CATEGORY_WEIGHT[category] ?? 0) + fact.confidence };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, budget);
  const events = world.events();
  const shape = world.stateShape() as { entities: unknown[]; facts: unknown[]; relationships: unknown[] };
  return {
    brandEntityId,
    facts: scored.map(({ fact, value, category }) => ({
      id: "fact:" + fact.predicate.split(":").slice(1).join(":"),
      category,
      statement: String(value.statement ?? ""),
      quote: String(value.quote ?? ""),
      sourceUrl: fact.source.url ?? "",
      confidence: fact.confidence,
      provenance: fact.source.kind + " " + (fact.source.by ?? "") + " " + fact.source.at
    })),
    gaps: current.filter((fact) => fact.predicate.startsWith("gap:")).map((fact) => fact.predicate.slice(4)),
    signals: [
      ...graph.incoming(brandEntityId, { via: "discusses" }).map((story) => ({
        id: String(story.attrs.evidenceId ?? story.id),
        kind: "conversation",
        summary: (story.name ?? "") + " (" + story.attrs.points + " points, " + story.attrs.comments + " comments)",
        provenance: "zetaris query " + (story.source.checksum ?? "")
      })),
      ...current.filter((fact) => fact.predicate.startsWith("attention:")).map((fact) => ({
        id: "world:" + fact.id,
        kind: "attention",
        summary: "Wikipedia views " + fact.predicate.split(":").pop() + ": " + String(fact.value),
        provenance: "zetaris query " + (fact.source.checksum ?? "")
      }))
    ],
    counts: {
      entities: shape.entities.length,
      facts: shape.facts.length,
      relationships: shape.relationships.length,
      events: events.length
    }
  };
}
