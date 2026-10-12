import type { BrandIdentity, SourceDocument } from "./schemas";
import { normalizeBranding } from "./brand-identity";
import { firecrawlScrape, firecrawlSearch, type FirecrawlPage } from "./firecrawl";
import { countWords } from "./json-values";

const maxSourceChars = 12000;

function normalizeText(value: string) {
  return value
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxSourceChars);
}

function sourceQuality(wordCount: number): SourceDocument["sourceQuality"] {
  if (wordCount >= 250) return "strong";
  if (wordCount >= 40) return "limited";
  return "none";
}

export type ScrapeSourceInput = {
  id: string;
  title?: string;
  url: string;
  sourceType: SourceDocument["sourceType"];
};

function failedSource(input: ScrapeSourceInput, fetchedAt: string, reason: string): SourceDocument {
  return {
    id: input.id,
    title: input.title || input.url,
    url: input.url,
    sourceType: input.sourceType,
    extractedText: `Source fetch failed: ${reason}`,
    fetchedAt,
    fetchStatus: "failed",
    wordCount: 0,
    sourceQuality: "none",
    failureReason: reason
  };
}

function pageSource(input: ScrapeSourceInput, page: FirecrawlPage, fetchedAt: string): SourceDocument {
  const extractedText = normalizeText(page.markdown);
  const wordCount = countWords(extractedText);
  const titled = { ...input, title: input.title || page.title || input.url };

  if (!wordCount) {
    return failedSource(titled, fetchedAt, "No readable text extracted");
  }

  return {
    id: titled.id,
    title: titled.title,
    url: input.url,
    sourceType: input.sourceType,
    extractedText,
    fetchedAt,
    fetchStatus: "fetched",
    wordCount,
    sourceQuality: sourceQuality(wordCount)
  };
}

export async function scrapeSourceDocument(input: ScrapeSourceInput, fetchedAt: string): Promise<SourceDocument> {
  try {
    return pageSource(input, await firecrawlScrape(input.url), fetchedAt);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown fetch error";
    return failedSource(input, fetchedAt, reason);
  }
}

export async function scrapeBrandSite(
  input: ScrapeSourceInput,
  fetchedAt: string
): Promise<{ source: SourceDocument; brandIdentity: BrandIdentity | null }> {
  try {
    const page = await firecrawlScrape(input.url, { branding: true });
    return {
      source: pageSource(input, page, fetchedAt),
      brandIdentity: normalizeBranding(page.branding, page.url || input.url)
    };
  } catch {
    // Branding is an enhancement; never lose the homepage text because of it.
    return { source: await scrapeSourceDocument(input, fetchedAt), brandIdentity: null };
  }
}

export async function searchSourceDocuments(
  query: string,
  limit: number,
  fetchedAt: string
): Promise<SourceDocument[]> {
  try {
    const results = await firecrawlSearch(query, limit);
    return results.slice(0, limit).map((result, index) => {
      const extractedText = normalizeText(result.markdown || result.description);
      const wordCount = countWords(extractedText);
      return {
        id: `src-search-${index + 1}`,
        title: result.title || result.url,
        url: result.url,
        sourceType: "search-result" as const,
        extractedText,
        fetchedAt,
        fetchStatus: wordCount ? "fetched" as const : "failed" as const,
        wordCount,
        sourceQuality: sourceQuality(wordCount),
        ...(wordCount ? {} : { failureReason: "No readable text extracted" })
      };
    });
  } catch {
    // Competitor search enriches discovery; the campaign can proceed without it.
    return [];
  }
}

export function noteSource(
  id: string,
  title: string,
  sourceType: SourceDocument["sourceType"],
  extractedText: string,
  fetchedAt: string,
  qualityOverride?: SourceDocument["sourceQuality"]
): SourceDocument {
  const wordCount = countWords(extractedText);
  return {
    id,
    title,
    sourceType,
    extractedText,
    fetchedAt,
    fetchStatus: "fetched",
    wordCount,
    sourceQuality: qualityOverride ?? sourceQuality(wordCount)
  };
}
