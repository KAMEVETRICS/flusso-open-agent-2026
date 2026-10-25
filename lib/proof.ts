import { confidencePercent, type Claim, type ClaimKind, type ProofReport, type SourceDocument } from "./schemas";

export type GeneratedClaim = {
  id: string;
  text: string;
  contentUsedIn: string;
  claimKind: Exclude<ClaimKind, "unclassified">;
  sourceId: string | null;
  evidenceQuote: string | null;
  confidence: number;
  status: "supported" | "unsupported" | "conflict" | "time-sensitive";
  recommendation: string;
};

const NON_FACTUAL_KINDS = new Set<ClaimKind>(["framing", "opinion"]);
const MIN_EXCERPT_CHARS = 20;
const UNSUPPORTED_CONFIDENCE_CAP = 49;

export function isFactualClaimKind(kind: ClaimKind) {
  return !NON_FACTUAL_KINDS.has(kind);
}

// A source can back a claim only if text was captured; whether it does is decided by the quote check.
export function isEvidenceSource(source: SourceDocument) {
  return (
    source.fetchStatus === "fetched" &&
    source.wordCount > 0 &&
    source.authority !== "internal" &&
    source.sourceType !== "prompt-library"
  );
}

// Reduces markdown and typography differences so a copied quote matches its page text.
export function normalizeForMatch(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[–—]/g, "-")
    .replace(/[*_`#>|\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// App screens and tables often lose the space between cells ("$750KPotential2.4x"), so the
// final comparison ignores whitespace.
function withoutWhitespace(value: string) {
  return value.replace(/\s/g, "");
}

export function excerptAppearsIn(excerpt: string, text: string) {
  const needle = normalizeForMatch(excerpt);
  return needle.length >= MIN_EXCERPT_CHARS && withoutWhitespace(normalizeForMatch(text)).includes(withoutWhitespace(needle));
}

export function summarizeProof(claims: Claim[]): ProofReport {
  const unresolved = claims.filter((claim) => claim.resolutionStatus === "unresolved");
  return {
    checkedClaims: claims.length,
    supported: claims.filter((claim) => claim.status === "supported").length,
    unsupported: unresolved.filter((claim) => claim.status === "unsupported").length,
    conflicts: unresolved.filter((claim) => claim.status === "conflict").length,
    timeSensitive: unresolved.filter((claim) => claim.status === "time-sensitive").length,
    editorial: claims.filter((claim) => claim.status === "editorial").length,
    claims
  };
}

// Turns governance output into stored claims. A factual claim keeps a supported, conflict, or
// time-sensitive status only when its quoted passage actually appears in the cited source.
export function normalizeGeneratedClaims(
  generated: GeneratedClaim[],
  sources: SourceDocument[],
  checkedAt: string
): { claims: Claim[]; idMap: Map<string, string> } {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const idMap = new Map<string, string>();

  const claims = generated.map((claim, index): Claim => {
    const id = "claim-" + (index + 1);
    idMap.set(claim.id, id);
    const base = {
      id,
      text: claim.text,
      contentUsedIn: claim.contentUsedIn,
      claimKind: claim.claimKind,
      checkedAt,
      confidence: confidencePercent(claim.confidence),
      resolutionStatus: "unresolved" as const,
      repairAction: null,
      repairNote: "",
      repairedAt: null
    };

    if (!isFactualClaimKind(claim.claimKind)) {
      return {
        ...base,
        status: "editorial",
        evidence: [],
        recommendation: "Editorial framing: review the tone and what it implies. It is not fact-checked."
      };
    }

    const source = claim.sourceId ? sourceById.get(claim.sourceId) : undefined;
    const quote = (claim.evidenceQuote ?? "").trim();
    const verified = source !== undefined && isEvidenceSource(source) && excerptAppearsIn(quote, source.extractedText);
    if (claim.status === "unsupported" || !source || !verified) {
      return {
        ...base,
        status: "unsupported",
        confidence: Math.min(base.confidence, UNSUPPORTED_CONFIDENCE_CAP),
        evidence: [],
        recommendation: claim.status === "unsupported"
          ? claim.recommendation
          : source
            ? "The quoted passage was not found in the cited source. Verify before publishing."
            : "No supplied source supports this claim. Verify before publishing."
      };
    }

    return {
      ...base,
      status: claim.status,
      sourceId: source.id,
      sourceTitle: source.title,
      sourceType: source.sourceType,
      evidence: [{
        sourceId: source.id,
        quote,
        locator: source.url ?? "",
        stance: claim.status === "conflict" ? "conflicts" : "supports"
      }],
      recommendation: claim.recommendation
    };
  });

  return { claims, idMap };
}
