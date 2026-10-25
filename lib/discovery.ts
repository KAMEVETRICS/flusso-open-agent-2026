import {
  ProjectBriefSchema,
  type BrandIdentity,
  type BriefInput,
  type ProjectBrief,
  type SourceDocument
} from "./schemas";
import { firecrawlMap, type FirecrawlLink } from "./firecrawl";
import {
  competitorSearchQuery,
  isLikelyUrl,
  isSameSiteFamily,
  mergeInferredBrief,
  missingBriefFields,
  pickKeyPages,
  splitSourceUrls,
  type BriefInference
} from "./discovery-helpers";
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
const SEARCH_RESULT_LIMIT = 3;

export interface BriefInferrer {
  inferBrief(input: BriefInput, sources: SourceDocument[]): Promise<BriefInference>;
}

export type DiscoveryResult = {
  brief: ProjectBrief;
  sources: SourceDocument[];
  inferredFields: string[];
  brandIdentity: BrandIdentity | null;
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

export async function discoverBrief(input: BriefInput, inferrer: BriefInferrer): Promise<DiscoveryResult> {
  const fetchedAt = new Date().toISOString();
  const searchCompetitors = input.competitors.length === 0;
  const docUrls = splitSourceUrls(input.docs).slice(0, MAX_DOC_URLS);
  const competitorUrls = input.competitors.filter(isLikelyUrl).slice(0, MAX_COMPETITOR_URLS);

  const [homepage, siteIndex, links, searchSources] = await Promise.all([
    scrapeBrandSite({
      id: "src-brand-site",
      title: input.brand ? `${input.brand} website` : undefined,
      url: input.website,
      sourceType: "website",
      authority: "first-party"
    }, fetchedAt),
    scrapeSiteIndex(input.website, fetchedAt),
    siteLinks(input.website),
    searchCompetitors
      ? searchSourceDocuments(competitorSearchQuery(input.website), SEARCH_RESULT_LIMIT, fetchedAt)
      : Promise.resolve<SourceDocument[]>([])
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
  const sources = [
    homepage.source,
    ...(homepage.structuredData ? [homepage.structuredData] : []),
    ...(siteIndex ? [siteIndex.source] : []),
    ...linkedSources,
    ...searchSources
  ];
  const site = homepage.source;
  const brandIdentity = homepage.brandIdentity;
  const evidence = sources.filter((source) => source.fetchStatus === "fetched");

  const missing = missingBriefFields(input);
  const needsCompetitorNames = searchCompetitors && searchSources.some((source) => source.fetchStatus === "fetched");
  let inferred: BriefInference | null = null;
  if (missing.length || needsCompetitorNames) {
    if (missing.length && !evidence.length) {
      const reason = site.failureReason ? ` (${site.failureReason})` : "";
      throw new Error(
        `Flusso could not read ${input.website}${reason}. Check the URL or fill in the optional brand details.`
      );
    }
    inferred = await inferrer.inferBrief(input, evidence);
  }

  const merged = mergeInferredBrief(input, inferred);
  const parsed = ProjectBriefSchema.safeParse(merged.brief);
  if (!parsed.success) {
    const fields = Array.from(new Set(parsed.error.issues.map((issue) => String(issue.path[0]))));
    const labels = fields.map((field) => fieldLabels[field] ?? field).join(", ");
    throw new Error(
      `Flusso could not determine the ${labels} from the website. Add ${fields.length > 1 ? "them" : "it"} under optional details.`
    );
  }

  return { brief: parsed.data, sources, inferredFields: merged.inferredFields, brandIdentity };
}
