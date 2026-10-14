/* global URL */
import type { Claim, DeliveryPack, SourceDocument } from "./schemas";
import { firecrawlSearch } from "./firecrawl";
import { countWords } from "./json-values";

export type WebVerdict = "supported" | "contradicted" | "not-found";

export type WebVerificationResult = {
  claimId: string;
  verdict: WebVerdict;
  evidenceDocumentId: string | null;
  evidenceExcerpt: string | null;
  confidence: number;
  note: string;
};

// A web page Firecrawl returned for one claim's search; the judge may cite only these.
export type EvidenceDocument = {
  id: string;
  claimId: string;
  url: string;
  title: string;
  text: string;
};

export const MAX_WEB_VERIFIED_CLAIMS = 10;
export const SEARCH_RESULTS_PER_CLAIM = 3;
const SEARCH_CONCURRENCY = 3;
const MAX_QUERY_CHARS = 400;
const MAX_DOCUMENT_CHARS = 6000;
const MIN_EXCERPT_CHARS = 20;
// Web pages are secondary evidence; never rank them above a supplied primary source.
const MAX_WEB_CONFIDENCE = 90;
const MAX_EXCERPT_CHARS = 1200;

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of Array.from(url.searchParams.keys())) {
      if (key.toLowerCase().startsWith("utm_")) url.searchParams.delete(key);
    }
    return url;
  } catch {
    return null;
  }
}

export function cleanUrl(value: string) {
  return parseHttpUrl(value)?.href ?? "";
}

// Comparison key: ignores scheme, www, trailing slashes, fragments, and tracking parameters.
export function urlKey(value: string) {
  const url = parseHttpUrl(value);
  if (!url) return "";
  return url.hostname.toLowerCase().replace(/^www\./, "") + url.pathname.replace(/\/+$/, "") + url.search;
}

export function webVerificationTargets(pack: DeliveryPack): Claim[] {
  return pack.proofReport.claims
    .filter((claim) => claim.resolutionStatus === "unresolved" && claim.status === "unsupported")
    .slice(0, MAX_WEB_VERIFIED_CLAIMS);
}

export function claimSearchQuery(claim: Pick<Claim, "text">, brand: string) {
  const text = claim.text.trim();
  const query = brand && !text.toLowerCase().includes(brand.toLowerCase()) ? brand + " " + text : text;
  return query.slice(0, MAX_QUERY_CHARS);
}

// Reduces markdown and typography differences so a copied quote matches its page text.
export function normalizeForMatch(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[–—]/g, "-")
    .replace(/[*_`#>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function excerptAppearsIn(excerpt: string, text: string) {
  const needle = normalizeForMatch(excerpt);
  return needle.length >= MIN_EXCERPT_CHARS && normalizeForMatch(text).includes(needle);
}

export async function gatherClaimEvidence(claims: Claim[], brand: string): Promise<EvidenceDocument[]> {
  const documents: EvidenceDocument[] = [];
  let next = 0;

  async function worker() {
    while (next < claims.length) {
      const claim = claims[next];
      next += 1;
      try {
        const results = await firecrawlSearch(claimSearchQuery(claim, brand), SEARCH_RESULTS_PER_CLAIM);
        results.slice(0, SEARCH_RESULTS_PER_CLAIM).forEach((result, index) => {
          const text = (result.markdown || result.description).slice(0, MAX_DOCUMENT_CHARS);
          if (!text.trim() || !cleanUrl(result.url)) return;
          documents.push({
            id: claim.id + "-doc-" + (index + 1),
            claimId: claim.id,
            url: cleanUrl(result.url),
            title: result.title || new URL(result.url).hostname,
            text
          });
        });
      } catch {
        // A failed search leaves only that claim without evidence.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, claims.length) }, worker));
  return documents;
}

export function applyWebVerification(
  pack: DeliveryPack,
  results: WebVerificationResult[],
  documents: EvidenceDocument[],
  verifiedAt: string
): { pack: DeliveryPack; supported: number; contradicted: number } {
  const targetIds = new Set(webVerificationTargets(pack).map((claim) => claim.id));
  const resultByClaim = new Map(
    results
      .filter((result) => targetIds.has(result.claimId))
      .map((result) => [result.claimId, result])
  );
  const documentById = new Map(documents.map((document) => [document.id, document]));
  const sources: SourceDocument[] = [...pack.sources];
  const webSourceByKey = new Map<string, SourceDocument>();
  let webSourceCount = sources.filter((source) => source.sourceType === "web-search").length;
  let supported = 0;
  let contradicted = 0;

  const claims = pack.proofReport.claims.map((claim): Claim => {
    const result = resultByClaim.get(claim.id);
    if (!result) return claim;

    const document = result.evidenceDocumentId ? documentById.get(result.evidenceDocumentId) : undefined;
    const excerpt = (result.evidenceExcerpt ?? "").trim().slice(0, MAX_EXCERPT_CHARS);
    if (
      result.verdict === "not-found" ||
      !document ||
      document.claimId !== claim.id ||
      !excerptAppearsIn(excerpt, document.text)
    ) {
      return {
        ...claim,
        recommendation: "Web search found no reliable source for this claim. Remove it or supply a primary source."
      };
    }

    const key = urlKey(document.url);
    let source = webSourceByKey.get(key);
    if (!source) {
      webSourceCount += 1;
      source = {
        id: "src-web-" + webSourceCount,
        title: document.title,
        url: document.url,
        sourceType: "web-search",
        extractedText: excerpt,
        fetchedAt: verifiedAt,
        fetchStatus: "fetched",
        wordCount: countWords(excerpt),
        sourceQuality: "limited"
      };
      webSourceByKey.set(key, source);
      sources.push(source);
    } else if (!source.extractedText.includes(excerpt)) {
      source.extractedText += "\n\n" + excerpt;
      source.wordCount = countWords(source.extractedText);
    }

    const verified = {
      ...claim,
      sourceId: source.id,
      sourceTitle: source.title,
      sourceType: "web-search",
      confidence: Math.min(Math.max(result.confidence, 0), MAX_WEB_CONFIDENCE)
    };
    if (result.verdict === "supported") {
      supported += 1;
      return {
        ...verified,
        status: "supported",
        recommendation: "Verified by web search. Review the cited page before publishing."
      };
    }
    contradicted += 1;
    return {
      ...verified,
      status: "conflict",
      recommendation: "Web evidence contradicts this claim" + (result.note.trim() ? ": " + result.note.trim() : ".")
    };
  });

  const unresolved = claims.filter((claim) => claim.resolutionStatus === "unresolved");
  return {
    pack: {
      ...pack,
      sources,
      proofReport: {
        checkedClaims: claims.length,
        supported: claims.filter((claim) => claim.status === "supported").length,
        unsupported: unresolved.filter((claim) => claim.status === "unsupported").length,
        conflicts: unresolved.filter((claim) => claim.status === "conflict").length,
        timeSensitive: unresolved.filter((claim) => claim.status === "time-sensitive").length,
        claims
      }
    },
    supported,
    contradicted
  };
}
