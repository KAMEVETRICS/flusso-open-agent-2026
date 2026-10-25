/* global console, fetch */
// Usage: npm run metrics -- <campaign-id | path/to/campaign.json>
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { findInternalNotes, findRepeatedHooks } from "../lib/editorial-policy.ts";

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
    return payload.pack;
  }
  const payload = JSON.parse(readFileSync(target, "utf8"));
  return payload.pack ?? payload;
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
  claims: {
    total: claims.length,
    byKind: tally(claims, (claim) => claim.claimKind),
    byStatus: tally(claims, (claim) => claim.status),
    factualWithVerifiedQuote: factual.filter((claim) => claim.evidence?.length).length,
    factualTotal: factual.length,
    supportedWithoutQuote: claims.filter((claim) => claim.status === "supported" && !claim.evidence?.length).length
  },
  calendar: { items: pack.calendar.length, repeatedHooks: findRepeatedHooks(pack.calendar).length },
  clientCopy: { internalNoteFindings: leaks.length, examples: leaks.slice(0, 3) },
  assets: pack.assets.length,
  stages: pack.generationStages.map((stage) => stage.label + " " + (stage.durationMs / 1000).toFixed(1) + "s")
}, null, 2));
