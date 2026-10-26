/* global console, fetch */
// Usage: npm run metrics -- <campaign-id | path/to/campaign.json>
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { findInternalNotes, findRepeatedHooks } from "../lib/editorial-policy.ts";
import { DeliveryPackSchema } from "../lib/schemas.ts";

const target = process.argv[2];
if (!target) {
  console.error("Usage: npm run metrics -- <campaign-id | path/to/campaign.json>");
  process.exit(64);
}

async function loadPack() {
  if (/^[0-9a-f-]{36}$/i.test(target)) {
    const engine = process.env.FLUSSO_ENGINE_URL?.trim() || "http://127.0.0.1:3107";
    const response = await fetch(new URL("/api/campaigns/" + target, engine));
    const payload = await response.json();
    if (!response.ok) throw new Error("Campaign request failed (HTTP " + response.status + "): " + (payload.error ?? ""));
    return DeliveryPackSchema.parse(payload.pack);
  }
  const payload = JSON.parse(readFileSync(target, "utf8"));
  // Older saved campaigns lack newer fields; the schema fills their defaults.
  return DeliveryPackSchema.parse(payload.pack ?? payload);
}

function tally(items, keyOf) {
  const counts = {};
  for (const item of items) {
    const key = keyOf(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const pack = await loadPack();
const webSources = pack.sources.filter(
  (source) => source.fetchStatus === "fetched" && !["prompt-library", "user-note"].includes(source.sourceType)
);
const claims = pack.proofReport.claims;
const factual = claims.filter((claim) => claim.status !== "editorial");
const clientText = [
  pack.brandContext.positioning,
  ...pack.brandContext.voice,
  ...pack.calendar.map((item) => item.hook),
  ...pack.assets.flatMap((asset) => [
    asset.title,
    asset.copy,
    asset.cta,
    ...asset.threadPosts,
    ...(asset.article
      ? [asset.article.subtitle, asset.article.introduction, ...asset.article.sections.flatMap((section) => [section.heading, section.body]), asset.article.conclusion]
      : [])
  ])
];
const leaks = clientText.flatMap((text) =>
  findInternalNotes(text ?? "").map((label) => ({ label, excerpt: String(text).slice(0, 100) }))
);

console.log(JSON.stringify({
  campaign: { brand: pack.brief.brand, generatedAt: pack.generation.generatedAt, model: pack.generation.model },
  sources: {
    readFromWeb: webSources.length,
    byType: tally(webSources, (source) => source.sourceType),
    byAuthority: tally(webSources, (source) => source.authority),
    partial: webSources.filter((source) => source.completeness === "truncated").length
  },
  facts: {
    total: pack.factSheet.facts.length,
    byCategory: tally(pack.factSheet.facts, (fact) => fact.category),
    gaps: pack.factSheet.gaps,
    rejected: pack.factSheet.rejectedFacts,
    extractionErrors: pack.factSheet.extractionErrors.length,
    followUps: pack.factSheet.discoverySteps.map((step) => step.reason + " via " + step.method + ": " + step.outcome)
  },
  strategy: pack.strategy
    ? {
        statementWords: pack.strategy.statement.trim().split(/\s+/).length,
        prioritySegmentResolved: Boolean(pack.strategy.prioritySegmentId),
        outOfScope: pack.strategy.outOfScope.length,
        successCriteria: pack.strategy.successCriteria.length
      }
    : null,
  hooks: {
    kept: pack.hooks.length,
    dropped: pack.droppedHooks.length,
    averageFit: pack.hooks.length
      ? Math.round((pack.hooks.reduce((sum, hook) => sum + hook.strategyFit, 0) / pack.hooks.length) * 10) / 10
      : 0
  },
  contentItems: {
    items: pack.contentItems.length,
    assetsLinked: pack.assets.filter((asset) => asset.contentItemId).length,
    repeatedCoreMessages: findRepeatedHooks(pack.contentItems.map((item) => ({ id: item.id, hook: item.coreMessage }))).length
  },
  claims: {
    total: claims.length,
    byKind: tally(claims, (claim) => claim.claimKind),
    byStatus: tally(claims, (claim) => claim.status),
    factualWithVerifiedQuote: factual.filter((claim) => claim.evidence?.length).length,
    factualTotal: factual.length,
    quotesWithSection: claims.filter((claim) => claim.evidence?.[0]?.sectionId).length,
    supportedWithoutQuote: claims.filter((claim) => claim.status === "supported" && !claim.evidence?.length).length
  },
  calendar: { items: pack.calendar.length, repeatedHooks: findRepeatedHooks(pack.calendar).length },
  clientCopy: { internalNoteFindings: leaks.length, examples: leaks.slice(0, 3) },
  assets: pack.assets.length,
  stages: pack.generationStages.map((stage) => stage.label + " " + (stage.durationMs / 1000).toFixed(1) + "s")
}, null, 2));
