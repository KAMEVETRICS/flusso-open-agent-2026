import {
  ProjectBriefSchema,
  type BrandIdentity,
  type BriefInput,
  type DiscoveryStep,
  type FactCategory,
  type FactSheet,
  type ProjectBrief,
  type SourceDocument
} from "./schemas";
import { firecrawlMap, type FirecrawlLink } from "./firecrawl";
import {
  isLikelyUrl,
  isSameSiteFamily,
  mergeInferredBrief,
  missingBriefFields,
  pickKeyPages,
  splitSourceUrls,
  type BriefInference,
  type SiteLink
} from "./discovery-helpers";
import {
  competitorNames,
  extractionSections,
  factGaps,
  gapPage,
  gapSearchQuery,
  isFactSource,
  numberFacts,
  pageKey,
  verifyFacts,
  type FactContext,
  type GeneratedFact,
  type UnnumberedFact
} from "./fact-sheet";
import type { SourceSection } from "./sections";
import {
  scrapeBrandSite,
  scrapeSiteIndex,
  scrapeSourceDocument,
  searchSourceDocuments
} from "./source-ingestion";

const MAP_LINK_LIMIT = 200;
const MAX_KEY_PAGES = 3;
const MAX_DOC_URLS = 5;
const MAX_COMPETITOR_URLS = 5;
// Pages and search results read beyond the homepage, docs, and site index before facts are trusted.
const MIN_CONTENT_SOURCES = 4;
const MAX_GAP_SEARCHES = 3;
const COMPETITOR_SEARCH_RESULTS = 3;
const GAP_SEARCH_RESULTS = 2;
const FACT_EXTRACTION_CONCURRENCY = 6;

export interface BriefInferrer {
  inferBrief(input: BriefInput, sources: SourceDocument[]): Promise<BriefInference>;
}

export interface DiscoveryModel extends BriefInferrer {
  extractFacts(context: FactContext, source: SourceDocument, sections: SourceSection[]): Promise<GeneratedFact[]>;
}

export type DiscoveryResult = {
  brief: ProjectBrief;
  sources: SourceDocument[];
  inferredFields: string[];
  brandIdentity: BrandIdentity | null;
  factSheet: FactSheet;
};

const fieldLabels: Record<string, string> = {
  brand: "brand name",
  industry: "industry",
  audience: "audience",
  tone: "tone",
  goal: "campaign goal",
  website: "website"
};

async function siteLinks(website: string): Promise<FirecrawlLink[]> {
  try {
    return await firecrawlMap(website, MAP_LINK_LIMIT);
  } catch (error) {
    // The homepage and llms.txt are still usable when the site cannot be mapped.
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Flusso site map failed: " + message);
    return [];
  }
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type FactRound = { facts: UnnumberedFact[]; rejected: number; errors: FactSheet["extractionErrors"] };

// Reads each source once for citable facts. A failed source is recorded; the others still count.
async function extractFactRound(
  sources: SourceDocument[],
  context: FactContext,
  model: DiscoveryModel,
  seenSections: Set<string>
): Promise<FactRound> {
  const work = sources
    .filter(isFactSource)
    .map((source) => ({ source, sections: extractionSections(source, seenSections) }))
    .filter((item) => item.sections.length);
  const outcomes = await mapWithConcurrency(work, FACT_EXTRACTION_CONCURRENCY, async ({ source, sections }) => {
    try {
      return { source, ...verifyFacts(await model.extractFacts(context, source, sections), source, sections, context.brand) };
    } catch (error) {
      return { source, facts: [], rejected: 0, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return {
    facts: outcomes.flatMap((outcome) => outcome.facts),
    rejected: outcomes.reduce((sum, outcome) => sum + outcome.rejected, 0),
    errors: outcomes.flatMap((outcome) =>
      "error" in outcome && outcome.error ? [{ sourceId: outcome.source.id, reason: outcome.error }] : []
    )
  };
}

type GapFetch = { reason: string; method: DiscoveryStep["method"]; target: string; sources: SourceDocument[]; failure?: string };

// One bounded follow-up round: an unread page on the brand's site for each missing category when
// one fits, otherwise a web search, plus extra pages when too few content sources were read.
async function fetchForGaps(
  gaps: FactCategory[],
  context: FactContext,
  links: SiteLink[],
  sources: SourceDocument[],
  fetchedAt: string
): Promise<GapFetch[]> {
  const takenUrls = sources.flatMap((source) => (source.url ? [source.url] : []));
  const taken = new Set(takenUrls.map(pageKey));
  let pageCount = sources.filter((source) => source.id.startsWith("src-site-page-")).length;
  let searchCount = sources.filter((source) => source.id.startsWith("src-search-")).length;
  let searchesLeft = MAX_GAP_SEARCHES;
  const fetches: Array<Promise<GapFetch>> = [];

  const fetchPage = (reason: string, url: string) => {
    takenUrls.push(url);
    taken.add(pageKey(url));
    pageCount += 1;
    const id = "src-site-page-" + pageCount;
    fetches.push(
      scrapeSourceDocument({ id, url, sourceType: "website", authority: "first-party" }, fetchedAt)
        .then((source) => ({ reason, method: "site-page" as const, target: url, sources: [source] }))
    );
  };

  for (const category of gaps) {
    const page = category === "competitor" ? null : gapPage(category, links, context.website, taken);
    if (page) {
      fetchPage(category + " gap", page);
      continue;
    }
    const query = gapSearchQuery(category, context);
    if (!query || !searchesLeft) continue;
    searchesLeft -= 1;
    const limit = category === "competitor" ? COMPETITOR_SEARCH_RESULTS : GAP_SEARCH_RESULTS;
    const firstIndex = searchCount + 1;
    searchCount += limit;
    fetches.push(
      searchSourceDocuments(query, context.website, limit, fetchedAt, firstIndex)
        .then((found) => ({
          reason: category + " gap",
          method: "web-search" as const,
          target: query,
          sources: found.filter((source) => !source.url || !taken.has(pageKey(source.url)))
        }))
        .catch((error: unknown) => ({
          reason: category + " gap",
          method: "web-search" as const,
          target: query,
          sources: [],
          failure: error instanceof Error ? error.message : String(error)
        }))
    );
  }

  const contentSources = sources.filter(
    (source) => source.fetchStatus === "fetched" && ["website", "primary-doc", "search-result", "competitor"].includes(source.sourceType)
  ).length;
  const extraPages = pickKeyPages(links, context.website, Math.max(0, MIN_CONTENT_SOURCES - contentSources - fetches.length), [], takenUrls);
  for (const url of extraPages) fetchPage("source minimum", url);

  return Promise.all(fetches);
}

function stepOutcome(fetch: GapFetch, factsAdded: number) {
  if (fetch.failure) return "Failed: " + fetch.failure;
  const read = fetch.sources.filter((source) => source.fetchStatus === "fetched");
  if (!read.length) return fetch.sources[0]?.failureReason ? "Failed: " + fetch.sources[0].failureReason : "No readable results";
  return factsAdded ? "Added " + factsAdded + " fact" + (factsAdded === 1 ? "" : "s") : "Read, but no new facts";
}

// Builds the fact sheet: facts from the sources already read, then one round of follow-up fetches
// for categories that still have no evidence.
async function researchFacts(
  context: FactContext,
  initialSources: SourceDocument[],
  links: SiteLink[],
  model: DiscoveryModel,
  fetchedAt: string
): Promise<{ sources: SourceDocument[]; factSheet: FactSheet }> {
  const seenSections = new Set<string>();
  const first = await extractFactRound(initialSources, context, model, seenSections);
  const gapsBefore = factGaps(first.facts);
  const fetches = await fetchForGaps(gapsBefore, context, links, initialSources, fetchedAt);
  const added = fetches.flatMap((fetch) => fetch.sources);
  const second = await extractFactRound(added, context, model, seenSections);

  const facts = numberFacts([...first.facts, ...second.facts]);
  const discoverySteps: DiscoveryStep[] = fetches.map((fetch) => {
    const sourceIds = fetch.sources.map((source) => source.id);
    const factsAdded = second.facts.filter((fact) => sourceIds.includes(fact.sourceId)).length;
    return { reason: fetch.reason, method: fetch.method, target: fetch.target, sourceIds, factsAdded, outcome: stepOutcome(fetch, factsAdded) };
  });
  return {
    sources: [...initialSources, ...added],
    factSheet: {
      facts,
      gaps: factGaps(facts),
      discoverySteps,
      rejectedFacts: first.rejected + second.rejected,
      extractionErrors: [...first.errors, ...second.errors]
    }
  };
}

function parseBrief(brief: unknown) {
  const parsed = ProjectBriefSchema.safeParse(brief);
  if (parsed.success) return parsed.data;
  const fields = Array.from(new Set(parsed.error.issues.map((issue) => String(issue.path[0]))));
  const labels = fields.map((field) => fieldLabels[field] ?? field).join(", ");
  throw new Error(
    `Flusso could not determine the ${labels} from the website. Add ${fields.length > 1 ? "them" : "it"} under optional details.`
  );
}

export async function discoverBrief(input: BriefInput, model: DiscoveryModel): Promise<DiscoveryResult> {
  const fetchedAt = new Date().toISOString();
  const docUrls = splitSourceUrls(input.docs).slice(0, MAX_DOC_URLS);
  const competitorUrls = input.competitors.filter(isLikelyUrl).slice(0, MAX_COMPETITOR_URLS);

  const [homepage, siteIndex, links] = await Promise.all([
    scrapeBrandSite({
      id: "src-brand-site",
      title: input.brand ? `${input.brand} website` : undefined,
      url: input.website,
      sourceType: "website",
      authority: "first-party"
    }, fetchedAt),
    scrapeSiteIndex(input.website, fetchedAt),
    siteLinks(input.website)
  ]);
  const pageUrls = pickKeyPages(links, input.website, MAX_KEY_PAGES, siteIndex?.links ?? [], docUrls);

  const linkedSources = await Promise.all([
    ...pageUrls.map((url, index) => scrapeSourceDocument({
      id: `src-site-page-${index + 1}`,
      url,
      sourceType: "website",
      authority: "first-party"
    }, fetchedAt)),
    ...docUrls.map((url, index) => scrapeSourceDocument({
      id: index === 0 ? "src-project-docs" : `src-project-docs-${index + 1}`,
      url,
      sourceType: "primary-doc",
      authority: isSameSiteFamily(url, input.website) ? "first-party" : "user-supplied"
    }, fetchedAt)),
    ...competitorUrls.map((url, index) => scrapeSourceDocument({
      id: `src-competitor-${index + 1}`,
      title: `Competitor source ${index + 1}`,
      url,
      sourceType: "competitor",
      authority: "third-party"
    }, fetchedAt))
  ]);
  const initialSources = [
    homepage.source,
    ...(homepage.structuredData ? [homepage.structuredData] : []),
    ...(siteIndex ? [siteIndex.source] : []),
    ...linkedSources
  ];
  const site = homepage.source;
  const evidence = initialSources.filter((source) => source.fetchStatus === "fetched");

  const missing = missingBriefFields(input);
  let inferred: BriefInference | null = null;
  if (missing.length) {
    if (!evidence.length) {
      const reason = site.failureReason ? ` (${site.failureReason})` : "";
      throw new Error(
        `Flusso could not read ${input.website}${reason}. Check the URL or fill in the optional brand details.`
      );
    }
    inferred = await model.inferBrief(input, evidence);
  }
  // Fail before paying for fact extraction when the brief cannot be completed.
  const draft = parseBrief(mergeInferredBrief(input, inferred).brief);

  const research = await researchFacts(
    { brand: draft.brand, industry: draft.industry, website: input.website },
    initialSources,
    [...(siteIndex?.links.map((url) => ({ url })) ?? []), ...links],
    model,
    fetchedAt
  );
  const factCompetitors = competitorNames(research.factSheet.facts);
  const merged = mergeInferredBrief(
    input,
    inferred || factCompetitors.length
      ? {
          ...(inferred ?? { brand: "", industry: "", audience: "", tone: "", competitors: [] }),
          competitors: [...(inferred?.competitors ?? []), ...factCompetitors]
        }
      : null
  );

  return {
    brief: parseBrief(merged.brief),
    sources: research.sources,
    inferredFields: merged.inferredFields,
    brandIdentity: homepage.brandIdentity,
    factSheet: research.factSheet
  };
}
