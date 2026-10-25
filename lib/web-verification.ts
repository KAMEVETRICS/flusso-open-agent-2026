/* global URL */
import { confidencePercent, type Claim, type DeliveryPack, type SourceDocument } from "./schemas";
import { isSameSiteFamily } from "./discovery-helpers";
import { firecrawlSearch } from "./firecrawl";
import { countWords } from "./json-values";
import { isEvidenceSource, summarizeProof } from "./proof";
import { createSectionIndex, splitIntoSections } from "./sections";
import { excerptAppearsIn } from "./text-match";

export type WebVerdict = "supported" | "contradicted" | "not-found";

export type WebVerificationResult = {
  claimId: string;
  verdict: WebVerdict;
  evidenceDocumentId: string | null;
  evidenceExcerpt: string | null;
  confidence: number;
  note: string;
};

// A candidate passage for one claim; the judge may cite only these. Local documents are sections
// of a captured source (sourceId and sectionId set); the rest are pages Firecrawl search returned.
export type EvidenceDocument = {
  id: string;
  claimId: string;
  url: string;
  title: string;
  text: string;
  sourceId?: string;
  sectionId?: string;
};

export const MAX_LOCAL_VERIFIED_CLAIMS = 20;
export const LOCAL_SECTIONS_PER_CLAIM = 3;
export const MAX_WEB_VERIFIED_CLAIMS = 10;
export const SEARCH_RESULTS_PER_CLAIM = 3;
const SEARCH_CONCURRENCY = 3;
const MAX_QUERY_CHARS = 400;
const MAX_DOCUMENT_CHARS = 6000;
// Web pages are secondary evidence; never rank them above a supplied primary source.
const MAX_WEB_CONFIDENCE = 90;
const MAX_LOCAL_CONFIDENCE = 95;
export const WEB_NOT_FOUND = "Web search found no reliable source for this claim. Remove it or supply a primary source.";
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

function isVerificationTarget(claim: Claim) {
  return claim.resolutionStatus === "unresolved" && claim.status === "unsupported";
}

export function verificationTargets(pack: DeliveryPack, limit: number): Claim[] {
  return pack.proofReport.claims.filter(isVerificationTarget).slice(0, limit);
}

// The captured sections that best match each claim. Checking these is free; web search is not.
export function localClaimEvidence(claims: Claim[], sources: SourceDocument[]): EvidenceDocument[] {
  const evidenceSources = sources.filter(isEvidenceSource);
  const sourceById = new Map(evidenceSources.map((source) => [source.id, source]));
  const index = createSectionIndex(evidenceSources.flatMap(splitIntoSections));
  return claims.flatMap((claim) =>
    index.search(claim.text, LOCAL_SECTIONS_PER_CLAIM).map(({ section }, position) => {
      const source = sourceById.get(section.sourceId) as SourceDocument;
      return {
        id: claim.id + "-local-" + (position + 1),
        claimId: claim.id,
        url: source.url ?? "",
        title: source.title + (section.heading ? " > " + section.heading : ""),
        text: section.text,
        sourceId: source.id,
        sectionId: section.id
      };
    })
  );
}

export function claimSearchQuery(claim: Pick<Claim, "text">, brand: string) {
  const text = claim.text.trim();
  const query = brand && !text.toLowerCase().includes(brand.toLowerCase()) ? brand + " " + text : text;
  return query.slice(0, MAX_QUERY_CHARS);
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
      } catch (error) {
        // A failed search leaves only that claim without evidence.
        const message = error instanceof Error ? error.message : String(error);
        console.warn("Flusso claim evidence search failed for " + claim.id + ": " + message);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, claims.length) }, worker));
  return documents;
}

// Applies the judge's verdicts. notFoundRecommendation replaces the recommendation of a claim
// that stays unsupported; null leaves it for a later round.
export function applyVerification(
  pack: DeliveryPack,
  results: WebVerificationResult[],
  documents: EvidenceDocument[],
  verifiedAt: string,
  notFoundRecommendation: string | null = WEB_NOT_FOUND
): { pack: DeliveryPack; supported: number; contradicted: number } {
  const targetIds = new Set(pack.proofReport.claims.filter(isVerificationTarget).map((claim) => claim.id));
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
      return notFoundRecommendation === null ? claim : { ...claim, recommendation: notFoundRecommendation };
    }

    const local = document.sourceId ? sources.find((candidate) => candidate.id === document.sourceId) : undefined;
    if (document.sourceId && !local) {
      return notFoundRecommendation === null ? claim : { ...claim, recommendation: notFoundRecommendation };
    }
    const key = urlKey(document.url);
    let source = local ?? webSourceByKey.get(key);
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
        // Only the quoted passage is stored, not the whole page.
        completeness: "truncated",
        authority: isSameSiteFamily(document.url, pack.brief.website) ? "first-party" : "third-party",
        contentHash: ""
      };
      webSourceByKey.set(key, source);
      sources.push(source);
    } else if (!local && !source.extractedText.includes(excerpt)) {
      source.extractedText += "\n\n" + excerpt;
      source.wordCount = countWords(source.extractedText);
    }

    const verified = {
      ...claim,
      sourceId: source.id,
      sourceTitle: source.title,
      sourceType: source.sourceType,
      evidence: [{
        sourceId: source.id,
        sectionId: document.sectionId ?? "",
        quote: excerpt,
        locator: document.url,
        stance: result.verdict === "supported" ? "supports" as const : "conflicts" as const
      }],
      checkedAt: verifiedAt,
      confidence: Math.min(confidencePercent(Math.max(result.confidence, 0)), local ? MAX_LOCAL_CONFIDENCE : MAX_WEB_CONFIDENCE)
    };
    if (result.verdict === "supported") {
      supported += 1;
      return {
        ...verified,
        status: "supported",
        recommendation: local
          ? "Found in a captured source during the evidence check. Review the passage before publishing."
          : "Verified by web search. Review the cited page before publishing."
      };
    }
    contradicted += 1;
    return {
      ...verified,
      status: "conflict",
      recommendation: (local ? "A captured source contradicts this claim" : "Web evidence contradicts this claim") +
        (result.note.trim() ? ": " + result.note.trim() : ".")
    };
  });

  return {
    pack: { ...pack, sources, proofReport: summarizeProof(claims) },
    supported,
    contradicted
  };
}
