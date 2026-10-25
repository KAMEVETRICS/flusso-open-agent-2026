import assert from "node:assert/strict";
import test from "node:test";
import { confidencePercent } from "../lib/schemas.ts";
import { excerptAppearsIn, isEvidenceSource, normalizeGeneratedClaims, summarizeProof } from "../lib/proof.ts";

const docsText = "## Protocol\nDoma documentation states that tokenized domains remain **DNS-compliant** and work like traditional domains. Doma supports Base, Solana, Avalanche, and Ethereum.";

const sources = [
  {
    id: "src-project-docs",
    title: "Doma docs",
    url: "https://docs.doma.xyz",
    sourceType: "primary-doc",
    extractedText: docsText,
    fetchedAt: "2026-10-25T00:00:00.000Z",
    fetchStatus: "fetched",
    wordCount: 24,
    completeness: "full",
    authority: "first-party",
    contentHash: "abc"
  },
  {
    id: "src-prompt-library",
    title: "Prompt library",
    sourceType: "prompt-library",
    extractedText: "13 prompts loaded from builtin:flusso-core-v1. Doma supports Base, Solana, Avalanche, and Ethereum.",
    fetchedAt: "2026-10-25T00:00:00.000Z",
    fetchStatus: "fetched",
    wordCount: 14,
    completeness: "full",
    authority: "internal",
    contentHash: ""
  }
];

function generated(id, overrides) {
  return {
    id,
    text: "Claim " + id,
    contentUsedIn: "asset-1",
    claimKind: "capability",
    sourceId: "src-project-docs",
    evidenceQuote: "tokenized domains remain DNS-compliant and work like traditional domains",
    confidence: 92,
    status: "supported",
    recommendation: "Keep as written.",
    ...overrides
  };
}

test("stores every confidence as a 0-100 percentage", () => {
  assert.equal(confidencePercent(0.99), 99);
  assert.equal(confidencePercent(97), 97);
  assert.equal(confidencePercent(0), 0);
  assert.equal(confidencePercent(1), 100);
});

test("only captured, non-internal sources can back a claim", () => {
  assert.equal(isEvidenceSource(sources[0]), true);
  assert.equal(isEvidenceSource(sources[1]), false);
  assert.equal(isEvidenceSource({ ...sources[0], fetchStatus: "failed" }), false);
});

test("keeps a claim supported only when its quote appears in the cited source", () => {
  const { claims, idMap } = normalizeGeneratedClaims([
    generated("model-a", {}),
    generated("model-b", { evidenceQuote: "Doma is the largest domain marketplace in the world today" }),
    generated("model-c", { claimKind: "framing", sourceId: null, evidenceQuote: null, status: "unsupported" }),
    generated("model-d", { sourceId: "src-prompt-library", evidenceQuote: "Doma supports Base, Solana, Avalanche, and Ethereum" }),
    generated("model-e", { status: "unsupported", sourceId: null, evidenceQuote: null, recommendation: "Ask the brand for a source." }),
    generated("model-f", { status: "conflict", claimKind: "comparison", confidence: 0.95 }),
    generated("model-g", { sourceId: "src-missing" })
  ], sources, "2026-10-25T12:00:00.000Z");

  assert.equal(idMap.get("model-a"), "claim-1");
  const [supported, wrongQuote, framing, internal, unsupported, conflict, missingSource] = claims;

  assert.equal(supported.status, "supported");
  assert.equal(supported.sourceTitle, "Doma docs");
  assert.equal(supported.checkedAt, "2026-10-25T12:00:00.000Z");
  assert.deepEqual(supported.evidence, [{
    sourceId: "src-project-docs",
    quote: "tokenized domains remain DNS-compliant and work like traditional domains",
    locator: "https://docs.doma.xyz",
    stance: "supports"
  }]);

  assert.equal(wrongQuote.status, "unsupported");
  assert.equal(wrongQuote.confidence, 49);
  assert.match(wrongQuote.recommendation, /quoted passage was not found/);
  assert.deepEqual(wrongQuote.evidence, []);

  assert.equal(framing.status, "editorial");
  assert.equal(framing.claimKind, "framing");

  assert.equal(internal.status, "unsupported", "internal sources are not evidence");
  assert.equal(unsupported.recommendation, "Ask the brand for a source.");

  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.confidence, 95);
  assert.equal(conflict.evidence[0].stance, "conflicts");

  assert.match(missingSource.recommendation, /No supplied source supports/);
});

test("matches quotes from app-screen markdown with escaped line breaks and joined cells", () => {
  const appScreen = "[![gochujang.com avatar](https://cdn.doma.xyz/a.png)\\\\\n\\\\\ng...\\\\\n\\\\\nToken FDV $311.8K0.39%\\\\\n\\\\\nBuyout price$750KPotential2.4x\\\\\n\\\\\nLive](https://app.doma.xyz/domain/gochujang.com)";
  assert.equal(excerptAppearsIn("Token FDV $311.8K 0.39% Buyout price $750K Potential 2.4x", appScreen), true);
  assert.equal(excerptAppearsIn("Token FDV $311.8K0.39%\nBuyout price$750KPotential2.4x", appScreen), true);
  assert.equal(excerptAppearsIn("Token FDV $311.8K 0.39% Buyout price $900K", appScreen), false);
});

test("summarizes the proof report, counting editorial framing separately", () => {
  const { claims } = normalizeGeneratedClaims([
    generated("a", {}),
    generated("b", { status: "unsupported", sourceId: null, evidenceQuote: null }),
    generated("c", { claimKind: "opinion" }),
    generated("d", { status: "time-sensitive", claimKind: "time-bound" })
  ], sources, "2026-10-25T12:00:00.000Z");
  claims.push({ ...claims[1], id: "claim-5", resolutionStatus: "repaired" });

  const report = summarizeProof(claims);
  assert.deepEqual(
    { ...report, claims: undefined },
    { checkedClaims: 5, supported: 1, unsupported: 1, conflicts: 0, timeSensitive: 1, editorial: 1, claims: undefined }
  );
});
