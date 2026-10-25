/* global URL */
import { createHash } from "node:crypto";
import type { BrandIdentity, SourceAuthority, SourceDocument } from "./schemas";
import { normalizeBranding } from "./brand-identity";
import { extractStructuredData, isSameSiteFamily, parseSiteIndexLinks, stripAgentInstructions } from "./discovery-helpers";
import { firecrawlScrape, firecrawlSearch, type FirecrawlPage, type FirecrawlScrape } from "./firecrawl";
import { countWords } from "./json-values";

// Whole pages are kept so later evidence stays findable; the cap only stops pathological pages.
// Prompts apply their own, smaller budget.
const MAX_STORED_CHARS = 100_000;
const MAX_SITE_INDEX_CHARS = 30_000;

function normalizeText(value: string) {
  return value
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function capture(raw: string, maxChars = MAX_STORED_CHARS) {
  const text = normalizeText(raw);
  return {
    text: text.slice(0, maxChars),
    completeness: text.length > maxChars ? "truncated" as const : "full" as const,
    contentHash: text ? createHash("sha256").update(text).digest("hex") : ""
  };
}

export type ScrapeSourceInput = {
  id: string;
  title?: string;
  url: string;
  sourceType: SourceDocument["sourceType"];
  authority: SourceAuthority;
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
    completeness: "failed",
    authority: input.authority,
    contentHash: "",
    failureReason: reason
  };
}

function pageSource(input: ScrapeSourceInput, page: FirecrawlPage, fetchedAt: string): SourceDocument {
  const captured = capture(page.markdown);
  const wordCount = countWords(captured.text);
  const titled = { ...input, title: input.title || page.title || input.url };

  if (!wordCount) {
    return failedSource(titled, fetchedAt, "No readable text extracted");
  }

  return {
    id: titled.id,
    title: titled.title,
    url: input.url,
    sourceType: input.sourceType,
    extractedText: captured.text,
    fetchedAt,
    fetchStatus: "fetched",
    wordCount,
    completeness: captured.completeness,
    authority: input.authority,
    contentHash: captured.contentHash
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

function structuredDataSource(rawHtml: string, url: string, fetchedAt: string): SourceDocument | null {
  const entities = extractStructuredData(rawHtml);
  if (!entities.length) return null;
  const captured = capture(JSON.stringify(entities, null, 2));
  return {
    id: "src-structured-data",
    title: "Structured data published on " + new URL(url).hostname,
    url,
    sourceType: "structured-data",
    extractedText: captured.text,
    fetchedAt,
    fetchStatus: "fetched",
    wordCount: countWords(captured.text),
    completeness: captured.completeness,
    authority: "first-party",
    contentHash: captured.contentHash
  };
}

export async function scrapeBrandSite(
  input: ScrapeSourceInput,
  fetchedAt: string
): Promise<{ source: SourceDocument; brandIdentity: BrandIdentity | null; structuredData: SourceDocument | null }> {
  try {
    const page = await firecrawlScrape(input.url, { branding: true, rawHtml: true });
    return {
      source: pageSource(input, page, fetchedAt),
      brandIdentity: normalizeBranding(page.branding, page.url || input.url),
      structuredData: structuredDataSource(page.rawHtml, page.url || input.url, fetchedAt)
    };
  } catch (error) {
    // Branding and structured data are enhancements; never lose the homepage text because of them.
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Flusso homepage branding scrape failed, retrying plain: " + message);
    return { source: await scrapeSourceDocument(input, fetchedAt), brandIdentity: null, structuredData: null };
  }
}

// Reads the brand's /llms.txt, a list of pages the brand itself considers important.
export async function scrapeSiteIndex(
  website: string,
  fetchedAt: string
): Promise<{ source: SourceDocument; links: string[] } | null> {
  const url = new URL("/llms.txt", website).href;
  let page: FirecrawlScrape;
  try {
    page = await firecrawlScrape(url);
  } catch {
    // Most sites have no llms.txt, so a missing file is the normal case.
    return null;
  }
  // Some sites answer every path with an HTML page instead of a 404.
  if (/text\/html/i.test(page.contentType)) return null;
  const cleaned = stripAgentInstructions(page.markdown);
  if (!cleaned.trim()) return null;

  const captured = capture(cleaned, MAX_SITE_INDEX_CHARS);
  return {
    source: {
      id: "src-site-index",
      title: "llms.txt index for " + new URL(website).hostname,
      url,
      sourceType: "site-index",
      extractedText: captured.text,
      fetchedAt,
      fetchStatus: "fetched",
      wordCount: countWords(captured.text),
      completeness: captured.completeness,
      authority: "first-party",
      contentHash: captured.contentHash
    },
    links: parseSiteIndexLinks(cleaned, website)
  };
}

export async function searchSourceDocuments(
  query: string,
  website: string,
  limit: number,
  fetchedAt: string
): Promise<SourceDocument[]> {
  try {
    const results = await firecrawlSearch(query, limit);
    return results.slice(0, limit).map((result, index) => {
      const captured = capture(result.markdown || result.description);
      const wordCount = countWords(captured.text);
      return {
        id: `src-search-${index + 1}`,
        title: result.title || result.url,
        url: result.url,
        sourceType: "search-result" as const,
        extractedText: captured.text,
        fetchedAt,
        fetchStatus: wordCount ? "fetched" as const : "failed" as const,
        wordCount,
        completeness: wordCount ? captured.completeness : "failed" as const,
        authority: isSameSiteFamily(result.url, website) ? "first-party" as const : "third-party" as const,
        contentHash: captured.contentHash,
        ...(wordCount ? {} : { failureReason: "No readable text extracted" })
      };
    });
  } catch (error) {
    // Competitor search enriches discovery; the campaign can proceed without it.
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Flusso competitor search failed: " + message);
    return [];
  }
}

export function noteSource(
  id: string,
  title: string,
  sourceType: SourceDocument["sourceType"],
  extractedText: string,
  fetchedAt: string,
  authority: SourceAuthority
): SourceDocument {
  const captured = capture(extractedText);
  return {
    id,
    title,
    sourceType,
    extractedText: captured.text,
    fetchedAt,
    fetchStatus: "fetched",
    wordCount: countWords(captured.text),
    completeness: captured.completeness,
    authority,
    contentHash: captured.contentHash
  };
}
