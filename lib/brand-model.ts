/* global URL */
import type { DeliveryPack, SourceDocument, VoiceGuide } from "./schemas";
import type { GeneratedFact } from "./fact-sheet";
import { ensureCampaignSchema, getDatabase } from "./db";

// A fact as cached against a source's content hash. The section is stored without the source ID,
// because the same page can get a different source ID in a later campaign.
export type CachedFact = Omit<GeneratedFact, "sectionId"> & { section: string };

export type BrandModel = {
  domain: string;
  brand: string;
  voiceGuide: VoiceGuide | null;
  vocabulary: { segments: string[]; territories: string[] };
  factCache: Record<string, { url: string; facts: CachedFact[]; cachedAt: string }>;
  campaignCount: number;
  updatedAt: string;
};

const MAX_CACHED_SOURCES = 60;

export function brandDomain(website: string) {
  return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
}

export function emptyBrandModel(domain: string): BrandModel {
  return {
    domain,
    brand: "",
    voiceGuide: null,
    vocabulary: { segments: [], territories: [] },
    factCache: {},
    campaignCount: 0,
    updatedAt: ""
  };
}

// Facts extracted from this exact page text in an earlier campaign, or null when the page is new
// or has changed.
export function cachedFactsFor(model: BrandModel | null, source: SourceDocument): GeneratedFact[] | null {
  const entry = source.contentHash ? model?.factCache[source.contentHash] : undefined;
  if (!entry) return null;
  return entry.facts.map(({ section, ...fact }) => ({ ...fact, sectionId: source.id + "#" + section }));
}

// Folds a finished campaign into the brand model: facts per page (including pages with none, so
// they are not read again), the latest segment and territory labels, and the voice guide.
export function learnFromCampaign(model: BrandModel, pack: DeliveryPack, learnedAt: string): BrandModel {
  const failed = new Set(pack.factSheet.extractionErrors.map((error) => error.sourceId));
  const factCache = { ...model.factCache };
  for (const source of pack.sources) {
    const readForFacts = source.fetchStatus === "fetched" && source.contentHash &&
      source.authority !== "internal" && source.sourceType !== "user-note" && source.sourceType !== "prompt-library";
    if (!readForFacts || failed.has(source.id)) continue;
    factCache[source.contentHash] = {
      url: source.url ?? "",
      cachedAt: learnedAt,
      facts: pack.factSheet.facts
        .filter((fact) => fact.sourceId === source.id)
        .map((fact) => ({
          category: fact.category,
          statement: fact.statement,
          entity: fact.entity,
          quote: fact.quote,
          timeSensitive: fact.timeSensitive,
          section: fact.sectionId.slice(fact.sectionId.indexOf("#") + 1)
        }))
    };
  }
  const newest = Object.entries(factCache)
    .sort((left, right) => right[1].cachedAt.localeCompare(left[1].cachedAt))
    .slice(0, MAX_CACHED_SOURCES);

  return {
    ...model,
    brand: pack.brief.brand,
    voiceGuide: pack.voiceGuide ?? model.voiceGuide,
    vocabulary: {
      segments: pack.audienceSegments.map((segment) => segment.name),
      territories: pack.territories.map((territory) => territory.name)
    },
    factCache: Object.fromEntries(newest),
    campaignCount: model.campaignCount + 1,
    updatedAt: learnedAt
  };
}

export async function getBrandModel(domain: string): Promise<BrandModel | null> {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const rows = await sql`SELECT model FROM brand_models WHERE domain = ${domain} LIMIT 1` as Array<{ model: unknown }>;
  if (!rows[0]) return null;
  const stored = (typeof rows[0].model === "string" ? JSON.parse(rows[0].model) : rows[0].model) as BrandModel;
  return { ...emptyBrandModel(domain), ...stored };
}

export async function saveBrandModel(model: BrandModel) {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const json = JSON.stringify(model);
  await sql`
    INSERT INTO brand_models (domain, model, updated_at)
    VALUES (${model.domain}, ${json}::jsonb, now())
    ON CONFLICT (domain) DO UPDATE SET model = EXCLUDED.model, updated_at = now()
  `;
}
