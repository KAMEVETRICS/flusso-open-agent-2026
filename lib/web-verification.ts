/* global URL */
import type { Claim, DeliveryPack, SourceDocument } from "./schemas";
import { asRecord, asText, countWords } from "./json-values";

export type WebVerdict = "supported" | "contradicted" | "not-found";

export type WebVerificationResult = {
  claimId: string;
  verdict: WebVerdict;
  evidenceUrl: string | null;
  evidenceTitle: string | null;
  evidenceExcerpt: string | null;
  confidence: number;
  note: string;
};

export const MAX_WEB_VERIFIED_CLAIMS = 15;
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

// Every URL the model actually consulted: search sources, opened pages, and inline citations.
export function consultedUrls(output: unknown[]): Set<string> {
  const urls = new Set<string>();
  const add = (value: unknown) => {
    const key = urlKey(asText(value));
    if (key) urls.add(key);
  };

  for (const entry of output) {
    const item = asRecord(entry);
    if (item.type === "web_search_call") {
      const action = asRecord(item.action);
      add(action.url);
      if (Array.isArray(action.sources)) {
        action.sources.forEach((source) => add(asRecord(source).url));
      }
    }
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        const annotations = asRecord(part).annotations;
        if (Array.isArray(annotations)) {
          annotations.forEach((annotation) => add(asRecord(annotation).url));
        }
      }
    }
  }

  return urls;
}

export function applyWebVerification(
  pack: DeliveryPack,
  results: WebVerificationResult[],
  consulted: Set<string>,
  verifiedAt: string
): { pack: DeliveryPack; supported: number; contradicted: number } {
  const targetIds = new Set(webVerificationTargets(pack).map((claim) => claim.id));
  const resultByClaim = new Map(
    results
      .filter((result) => targetIds.has(result.claimId))
      .map((result) => [result.claimId, result])
  );
  const sources: SourceDocument[] = [...pack.sources];
  const webSourceByKey = new Map<string, SourceDocument>();
  let webSourceCount = sources.filter((source) => source.sourceType === "web-search").length;
  let supported = 0;
  let contradicted = 0;

  const claims = pack.proofReport.claims.map((claim): Claim => {
    const result = resultByClaim.get(claim.id);
    if (!result) return claim;

    const evidenceUrl = cleanUrl(result.evidenceUrl ?? "");
    const evidenceKey = urlKey(evidenceUrl);
    const excerpt = (result.evidenceExcerpt ?? "").trim().slice(0, MAX_EXCERPT_CHARS);
    if (result.verdict === "not-found" || !evidenceKey || !consulted.has(evidenceKey) || !excerpt) {
      return {
        ...claim,
        recommendation: "Web search found no reliable source for this claim. Remove it or supply a primary source."
      };
    }

    let source = webSourceByKey.get(evidenceKey);
    if (!source) {
      webSourceCount += 1;
      source = {
        id: "src-web-" + webSourceCount,
        title: result.evidenceTitle?.trim() || new URL(evidenceUrl).hostname,
        url: evidenceUrl,
        sourceType: "web-search",
        extractedText: excerpt,
        fetchedAt: verifiedAt,
        fetchStatus: "fetched",
        wordCount: countWords(excerpt),
        sourceQuality: "limited"
      };
      webSourceByKey.set(evidenceKey, source);
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
