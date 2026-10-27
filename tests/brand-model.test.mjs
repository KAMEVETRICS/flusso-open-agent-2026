/* global Response */
import assert from "node:assert/strict";
import process from "node:process";
import test, { afterEach } from "node:test";
import { brandDomain, cachedFactsFor, emptyBrandModel, learnFromCampaign } from "../lib/brand-model.ts";
import { discoverBrief } from "../lib/discovery.ts";
import { inspectEditorialAssets } from "../lib/editorial-policy.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const input = {
  website: "https://www.doma.xyz",
  goal: "Onboard domain flippers onchain",
  brand: "", industry: "", audience: "", tone: "", docs: "", competitors: [],
  platforms: ["X"], editorialProfile: "balanced", durationDays: 30, postsPerWeek: 5, teamSize: 1, hoursPerWeek: 8,
  restrictions: "", documents: []
};

function stubSite() {
  process.env.FIRECRAWL_API_KEY = "fc-test";
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const endpoint = String(url).split("/v2/")[1];
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (endpoint === "map") return json({ success: true, links: [] });
    if (endpoint === "search") return json({ success: true, data: { web: [] } });
    if (body.url === "https://www.doma.xyz") {
      return json({ success: true, data: { markdown: "## Protocol\nDoma tokenizes DNS domains so they can be traded onchain while staying DNS-compliant.", metadata: { statusCode: 200 } } });
    }
    return json({ success: false, error: "not found" }, 404);
  };
}

function fakeModel(calls) {
  return {
    async inferBrief() {
      return { brand: "Doma", industry: "DomainFi", audience: "Domain investors", tone: "Direct", competitors: [] };
    },
    async extractVoiceGuide() {
      calls.voice += 1;
      return {
        summary: "Plain and precise.",
        toneRules: ["Short sentences."],
        preferredTerms: [{ term: "tokenized domain", note: "Use for the onchain asset." }],
        avoidTerms: [{ term: "NFT domain", reason: "Doma names are DNS domains." }],
        sampleLines: [
          { quote: "Doma tokenizes DNS domains so they can be traded onchain", sourceId: "src-brand-site" },
          { quote: "Doma is the fastest chain on earth by a wide margin", sourceId: "src-brand-site" }
        ]
      };
    },
    async extractFacts(_context, source) {
      calls.facts.push(source.id);
      return source.id === "src-brand-site"
        ? [{ category: "product", statement: "Doma tokenizes DNS domains.", entity: "", sectionId: "src-brand-site#protocol", quote: "Doma tokenizes DNS domains so they can be traded onchain", timeSensitive: false }]
        : [];
    }
  };
}

test("keys brand models by domain without www", () => {
  assert.equal(brandDomain("https://www.Doma.xyz/app"), "doma.xyz");
});

test("a second campaign reuses facts for unchanged pages and the saved voice guide", async () => {
  stubSite();
  const firstCalls = { facts: [], voice: 0 };
  const first = await discoverBrief(input, fakeModel(firstCalls));
  assert.deepEqual(firstCalls.facts, ["src-brand-site"]);
  assert.equal(firstCalls.voice, 1);
  assert.equal(first.voiceGuide.sampleLines.length, 1, "the invented sample line is dropped");
  assert.equal(first.brandMemory, null);

  const pack = {
    brief: first.brief,
    sources: first.sources,
    factSheet: first.factSheet,
    voiceGuide: first.voiceGuide,
    audienceSegments: [{ name: "Domain flippers" }],
    territories: [{ name: "Onchain liquidity" }]
  };
  const memory = learnFromCampaign(emptyBrandModel("doma.xyz"), pack, "2026-10-27T00:00:00.000Z");
  assert.equal(memory.campaignCount, 1);
  assert.deepEqual(memory.vocabulary, { segments: ["Domain flippers"], territories: ["Onchain liquidity"] });

  const homepage = first.sources.find((source) => source.id === "src-brand-site");
  assert.deepEqual(cachedFactsFor(memory, { ...homepage, id: "src-site-page-2" }).map((fact) => fact.sectionId), ["src-site-page-2#protocol"]);
  assert.equal(cachedFactsFor(memory, { ...homepage, contentHash: "changed" }), null);

  const secondCalls = { facts: [], voice: 0 };
  const second = await discoverBrief(input, fakeModel(secondCalls), memory);
  assert.deepEqual(secondCalls.facts, [], "no extraction call for an unchanged page");
  assert.equal(secondCalls.voice, 0, "the voice guide is reused");
  assert.deepEqual(second.factSheet.facts.map((fact) => fact.statement), ["Doma tokenizes DNS domains."]);
  assert.deepEqual(second.brandMemory, {
    priorCampaigns: 1,
    reusedSourceIds: ["src-brand-site"],
    reusedVoiceGuide: true,
    reusedLabels: ["Domain flippers", "Onchain liquidity"]
  });
});

test("uploaded documents become user-supplied sources", async () => {
  stubSite();
  const calls = { facts: [], voice: 0 };
  const result = await discoverBrief({ ...input, documents: [{ title: "Pitch deck", text: "## Traction\nDoma has tokenized more than forty million domains across registrars." }] }, fakeModel(calls));
  const upload = result.sources.find((source) => source.id === "src-upload-1");
  assert.equal(upload.title, "Pitch deck");
  assert.equal(upload.authority, "user-supplied");
  assert.equal(upload.sourceType, "uploaded-document");
  assert.ok(calls.facts.includes("src-upload-1"));
});

test("flags words the brand voice guide avoids", () => {
  const asset = {
    id: "asset-1", type: "post", platform: "LinkedIn", title: "Own your NFT domain", copy: "A tokenized domain stays a real domain.",
    cta: "", linkedClaims: [], calendarItemId: "", contentItemId: "", seriesId: "", segment: "", territory: "", hookId: "",
    editorialMode: "direct-practical", contentFormat: "short-post", threadPosts: [], article: null, slides: [], videoScript: null, visualBriefId: ""
  };
  const issues = inspectEditorialAssets([asset], { platforms: ["LinkedIn"] }, ["NFT domain", "web3"]);
  assert.deepEqual(issues.map((issue) => issue.code), ["voice-avoid-term"]);
  assert.match(issues[0].message, /"NFT domain"/);
});
