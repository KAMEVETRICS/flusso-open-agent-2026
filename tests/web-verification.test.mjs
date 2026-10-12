import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWebVerification,
  consultedUrls,
  urlKey,
  webVerificationTargets
} from "../lib/web-verification.ts";

function claim(id, status, extra = {}) {
  return {
    id,
    text: "Claim " + id,
    contentUsedIn: "asset-1",
    confidence: 40,
    status,
    recommendation: "Fetch and verify a primary source before publishing this claim.",
    resolutionStatus: "unresolved",
    repairAction: null,
    repairNote: "",
    repairedAt: null,
    ...extra
  };
}

function pack(claims) {
  return {
    sources: [{
      id: "src-brand-site",
      title: "Arc House",
      url: "https://arc.house",
      sourceType: "website",
      extractedText: "Home",
      fetchedAt: "2026-10-11T00:00:00.000Z",
      fetchStatus: "fetched",
      wordCount: 1,
      sourceQuality: "limited"
    }],
    proofReport: {
      checkedClaims: claims.length,
      supported: 0,
      unsupported: claims.length,
      conflicts: 0,
      timeSensitive: 0,
      claims
    }
  };
}

function result(claimId, verdict, evidenceUrl, extra = {}) {
  return {
    claimId,
    verdict,
    evidenceUrl,
    evidenceTitle: "Arc docs",
    evidenceExcerpt: "Arc settles payments in USDC.",
    confidence: 97,
    note: "",
    ...extra
  };
}

test("normalizes URLs for comparison", () => {
  assert.equal(
    urlKey("https://www.Docs.arc.house/settlement/?utm_source=openai#top"),
    urlKey("http://docs.arc.house/settlement")
  );
  assert.notEqual(urlKey("https://arc.house/a?page=2"), urlKey("https://arc.house/a"));
  assert.equal(urlKey("ftp://arc.house/file"), "");
});

test("collects consulted URLs from search sources, opened pages, and citations", () => {
  const urls = consultedUrls([
    { type: "web_search_call", action: { type: "search", sources: [{ type: "url", url: "https://a.example/one" }] } },
    { type: "web_search_call", action: { type: "open_page", url: "https://b.example/two" } },
    { type: "message", content: [{ type: "output_text", annotations: [{ type: "url_citation", url: "https://c.example/three?utm_source=openai" }] }] },
    { type: "reasoning" }
  ]);
  assert.deepEqual([...urls].sort(), ["a.example/one", "b.example/two", "c.example/three"]);
});

test("targets only unresolved unsupported claims", () => {
  const targets = webVerificationTargets(pack([
    claim("claim-1", "unsupported"),
    claim("claim-2", "supported"),
    claim("claim-3", "unsupported", { resolutionStatus: "repaired" }),
    claim("claim-4", "time-sensitive")
  ]));
  assert.deepEqual(targets.map((item) => item.id), ["claim-1"]);
});

test("accepts evidence only from consulted pages and recounts the proof report", () => {
  const consulted = consultedUrls([
    { type: "web_search_call", action: { sources: [{ url: "https://docs.arc.house/settlement" }, { url: "https://news.example/arc" }] } }
  ]);
  const { pack: verified, supported, contradicted } = applyWebVerification(
    pack([
      claim("claim-1", "unsupported"),
      claim("claim-2", "unsupported"),
      claim("claim-3", "unsupported"),
      claim("claim-4", "unsupported"),
      claim("claim-5", "supported", { sourceId: "src-brand-site" })
    ]),
    [
      result("claim-1", "supported", "https://docs.arc.house/settlement/?utm_source=openai"),
      result("claim-2", "contradicted", "https://news.example/arc", { note: "Settlement uses EURC." }),
      result("claim-3", "supported", "https://invented.example/page"),
      result("claim-4", "supported", "https://docs.arc.house/settlement", { evidenceExcerpt: "Arc supports refunds." }),
      result("claim-5", "contradicted", "https://news.example/arc")
    ],
    consulted,
    "2026-10-11T12:00:00.000Z"
  );

  const byId = new Map(verified.proofReport.claims.map((item) => [item.id, item]));
  assert.equal(supported, 2);
  assert.equal(contradicted, 1);

  assert.equal(byId.get("claim-1").status, "supported");
  assert.equal(byId.get("claim-1").sourceId, "src-web-1");
  assert.equal(byId.get("claim-1").sourceType, "web-search");
  assert.equal(byId.get("claim-1").confidence, 90);

  assert.equal(byId.get("claim-2").status, "conflict");
  assert.match(byId.get("claim-2").recommendation, /Settlement uses EURC/);

  assert.equal(byId.get("claim-3").status, "unsupported");
  assert.match(byId.get("claim-3").recommendation, /no reliable source/);

  assert.equal(byId.get("claim-4").sourceId, "src-web-1");
  assert.equal(byId.get("claim-5").status, "supported");
  assert.equal(byId.get("claim-5").sourceId, "src-brand-site");

  const webSources = verified.sources.filter((source) => source.sourceType === "web-search");
  assert.equal(webSources.length, 2);
  assert.equal(webSources[0].url, "https://docs.arc.house/settlement/");
  assert.match(webSources[0].extractedText, /USDC[\s\S]*refunds/);
  assert.equal(webSources[0].sourceQuality, "limited");

  assert.deepEqual(
    {
      checkedClaims: verified.proofReport.checkedClaims,
      supported: verified.proofReport.supported,
      unsupported: verified.proofReport.unsupported,
      conflicts: verified.proofReport.conflicts
    },
    { checkedClaims: 5, supported: 3, unsupported: 1, conflicts: 1 }
  );
});
