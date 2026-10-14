/* global Response */
import assert from "node:assert/strict";
import process from "node:process";
import test, { afterEach } from "node:test";
import {
  applyWebVerification,
  claimSearchQuery,
  excerptAppearsIn,
  gatherClaimEvidence,
  urlKey,
  webVerificationTargets
} from "../lib/web-verification.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

function result(claimId, verdict, evidenceDocumentId, extra = {}) {
  return {
    claimId,
    verdict,
    evidenceDocumentId,
    evidenceExcerpt: "Arc settles merchant payments in USDC within seconds.",
    confidence: 97,
    note: "",
    ...extra
  };
}

const documents = [
  {
    id: "claim-1-doc-1",
    claimId: "claim-1",
    url: "https://docs.arc.house/settlement",
    title: "Arc settlement docs",
    text: "## Settlement\nArc **settles merchant payments** in USDC within seconds. Refunds use the [refund API](https://docs.arc.house/refunds)."
  },
  {
    id: "claim-2-doc-1",
    claimId: "claim-2",
    url: "https://news.example/arc",
    title: "Arc news",
    text: "Arc settles merchant payments in EURC, not USDC, according to the filing."
  },
  {
    id: "claim-4-doc-1",
    claimId: "claim-4",
    url: "https://www.docs.arc.house/settlement/",
    title: "Arc settlement docs",
    text: "Refunds use the refund API and settle back to the original wallet."
  }
];

test("normalizes URLs for comparison", () => {
  assert.equal(
    urlKey("https://www.Docs.arc.house/settlement/?utm_source=openai#top"),
    urlKey("http://docs.arc.house/settlement")
  );
  assert.notEqual(urlKey("https://arc.house/a?page=2"), urlKey("https://arc.house/a"));
  assert.equal(urlKey("ftp://arc.house/file"), "");
});

test("prefixes the brand to search queries only when the claim omits it", () => {
  assert.equal(claimSearchQuery({ text: "Settles in USDC" }, "Arc House"), "Arc House Settles in USDC");
  assert.equal(claimSearchQuery({ text: "Arc House settles in USDC" }, "Arc House"), "Arc House settles in USDC");
});

test("matches quotes through markdown, typography, and whitespace differences", () => {
  const page = "Arc **settles merchant payments** in USDC — see the [refund API](https://x.y/r).\n\nIt’s fast.";
  assert.equal(excerptAppearsIn("Arc settles merchant payments in USDC - see the refund API.", page), true);
  assert.equal(excerptAppearsIn("It's fast.", page), false, "too short to be meaningful evidence");
  assert.equal(excerptAppearsIn("Arc settles merchant payments in EURC", page), false);
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

test("gathers evidence per claim through Firecrawl search and tolerates failures", async () => {
  process.env.FIRECRAWL_API_KEY = "fc-test";
  const queries = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    queries.push(body.query);
    if (body.query.includes("claim-2")) return new Response(JSON.stringify({ success: false, error: "rate limited" }), { status: 429 });
    return new Response(JSON.stringify({
      success: true,
      data: { web: [
        { url: "https://docs.arc.house/a?utm_source=x", title: "A", markdown: "Evidence text" },
        { url: "https://b.example/b", title: "", description: "Snippet only" },
        { url: "not a url", title: "Bad", markdown: "ignored" }
      ] }
    }), { status: 200 });
  };

  const found = await gatherClaimEvidence([claim("claim-1", "unsupported"), claim("claim-2", "unsupported")], "Arc");
  assert.deepEqual(queries.sort(), ["Arc Claim claim-1", "Arc Claim claim-2"]);
  assert.deepEqual(found.map((document) => [document.id, document.url, document.title]), [
    ["claim-1-doc-1", "https://docs.arc.house/a", "A"],
    ["claim-1-doc-2", "https://b.example/b", "b.example"]
  ]);
});

test("accepts only quotes that appear in that claim's own fetched documents", () => {
  const { pack: verified, supported, contradicted } = applyWebVerification(
    pack([
      claim("claim-1", "unsupported"),
      claim("claim-2", "unsupported"),
      claim("claim-3", "unsupported"),
      claim("claim-4", "unsupported"),
      claim("claim-5", "unsupported"),
      claim("claim-6", "supported", { sourceId: "src-brand-site" })
    ]),
    [
      result("claim-1", "supported", "claim-1-doc-1"),
      result("claim-2", "contradicted", "claim-2-doc-1", {
        evidenceExcerpt: "Arc settles merchant payments in EURC, not USDC",
        note: "The filing says EURC."
      }),
      result("claim-3", "supported", "claim-1-doc-1"),
      result("claim-4", "supported", "claim-4-doc-1", { evidenceExcerpt: "Refunds use the refund API and settle back to the original wallet." }),
      result("claim-5", "supported", "claim-5-doc-9"),
      result("claim-6", "contradicted", "claim-2-doc-1")
    ],
    documents,
    "2026-10-14T12:00:00.000Z"
  );

  const byId = new Map(verified.proofReport.claims.map((item) => [item.id, item]));
  assert.equal(supported, 2);
  assert.equal(contradicted, 1);

  assert.equal(byId.get("claim-1").status, "supported");
  assert.equal(byId.get("claim-1").sourceId, "src-web-1");
  assert.equal(byId.get("claim-1").sourceType, "web-search");
  assert.equal(byId.get("claim-1").confidence, 90);

  assert.equal(byId.get("claim-2").status, "conflict");
  assert.match(byId.get("claim-2").recommendation, /The filing says EURC/);

  assert.equal(byId.get("claim-3").status, "unsupported", "cites another claim's document");
  assert.match(byId.get("claim-3").recommendation, /no reliable source/);

  assert.equal(byId.get("claim-4").sourceId, "src-web-1", "same page shares one source");
  assert.equal(byId.get("claim-5").status, "unsupported", "unknown document id");
  assert.equal(byId.get("claim-6").status, "supported", "non-target claims are untouched");

  const webSources = verified.sources.filter((source) => source.sourceType === "web-search");
  assert.equal(webSources.length, 2);
  assert.match(webSources[0].extractedText, /USDC within seconds[\s\S]*original wallet/);
  assert.equal(webSources[0].sourceQuality, "limited");

  assert.deepEqual(
    {
      checkedClaims: verified.proofReport.checkedClaims,
      supported: verified.proofReport.supported,
      unsupported: verified.proofReport.unsupported,
      conflicts: verified.proofReport.conflicts
    },
    { checkedClaims: 6, supported: 3, unsupported: 2, conflicts: 1 }
  );
});

test("rejects a supported verdict whose quote is not on the cited page", () => {
  const { pack: verified } = applyWebVerification(
    pack([claim("claim-1", "unsupported")]),
    [result("claim-1", "supported", "claim-1-doc-1", { evidenceExcerpt: "Arc is the fastest settlement network in the world." })],
    documents,
    "2026-10-14T12:00:00.000Z"
  );
  assert.equal(verified.proofReport.claims[0].status, "unsupported");
  assert.equal(verified.sources.length, 1);
});
