/* global Response */
import assert from "node:assert/strict";
import process from "node:process";
import test, { afterEach } from "node:test";
import { discoverBrief } from "../lib/discovery.ts";
import {
  competitorNames,
  extractionSections,
  factGaps,
  gapPage,
  gapSearchQuery,
  numberFacts,
  verifyFacts
} from "../lib/fact-sheet.ts";
import { splitIntoSections } from "../lib/sections.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function source(id, extractedText, extra = {}) {
  return {
    id,
    title: id,
    url: "https://doma.xyz/" + id,
    sourceType: "website",
    extractedText,
    fetchedAt: "2026-10-25T00:00:00.000Z",
    fetchStatus: "fetched",
    wordCount: extractedText.split(/\s+/).length,
    completeness: "full",
    authority: "first-party",
    contentHash: "",
    ...extra
  };
}

const home = source("src-brand-site", [
  "## Trending",
  "Token FDV and buyout price for every tokenized domain on Doma.",
  "",
  "## Protocol",
  "Doma tokenizes DNS domains so they can be traded onchain while staying DNS-compliant."
].join("\n"));

function generated(overrides) {
  return {
    category: "product",
    statement: "Doma tokenizes DNS domains for onchain trading.",
    entity: "",
    sectionId: "src-brand-site#protocol",
    quote: "Doma tokenizes DNS domains so they can be traded onchain",
    timeSensitive: false,
    ...overrides
  };
}

test("reads each passage once across sources", () => {
  const seen = new Set();
  const page = source("src-site-page-1", "## Trending\nToken FDV and buyout price for every tokenized domain on Doma.\n\n## Pricing\nListing a domain costs nothing; trades pay a 1% fee.");
  assert.deepEqual(extractionSections(home, seen).map((section) => section.id), ["src-brand-site#trending", "src-brand-site#protocol"]);
  assert.deepEqual(extractionSections(page, seen).map((section) => section.id), ["src-site-page-1#pricing"]);
});

test("keeps facts whose quotes appear in the source and rejects the rest", () => {
  const offered = splitIntoSections(home);
  const { facts, rejected } = verifyFacts([
    generated({}),
    generated({ sectionId: "src-brand-site#trending", statement: "Relocated" }),
    generated({ quote: "Doma is the largest domain marketplace in the world", statement: "Invented" }),
    generated({ category: "competitor", entity: "", statement: "No entity" }),
    generated({ category: "competitor", entity: "Doma", statement: "The brand itself" })
  ], home, offered, "Doma");

  assert.equal(rejected, 3);
  assert.deepEqual(facts.map((fact) => [fact.statement, fact.sectionId, fact.authority]), [
    ["Doma tokenizes DNS domains for onchain trading.", "src-brand-site#protocol", "first-party"],
    ["Relocated", "src-brand-site#protocol", "first-party"]
  ]);
});

test("numbers facts by category and drops repeats", () => {
  const base = { entity: "", sourceId: "s", sectionId: "s#a", quote: "q", authority: "first-party", timeSensitive: false };
  const facts = numberFacts([
    { ...base, category: "company", statement: "Doma was founded in 2023." },
    { ...base, category: "competitor", statement: "Namefi tokenizes domains.", entity: "Namefi" },
    { ...base, category: "product", statement: "Doma tokenizes domains." },
    { ...base, category: "product", statement: "Doma  tokenizes domains." },
    { ...base, category: "competitor", statement: "3DNS is an alternative.", entity: "namefi" }
  ]);
  assert.deepEqual(facts.map((fact) => [fact.id, fact.category]), [
    ["fact-1", "product"],
    ["fact-2", "competitor"],
    ["fact-3", "competitor"],
    ["fact-4", "company"]
  ]);
  assert.deepEqual(factGaps(facts), ["audience", "proof", "pricing"]);
  assert.deepEqual(competitorNames(facts), ["Namefi"]);
});

test("finds the shallowest unread same-site page for a gap", () => {
  const links = [
    { url: "https://doma.xyz/docs/fees/schedule" },
    { url: "https://doma.xyz/fees" },
    { url: "https://other.xyz/pricing" },
    { url: "https://doma.xyz/x", title: "Use cases" }
  ];
  assert.equal(gapPage("pricing", links, "https://doma.xyz", new Set()), "https://doma.xyz/fees");
  assert.equal(gapPage("pricing", links, "https://doma.xyz", new Set(["doma.xyz/fees"])), "https://doma.xyz/docs/fees/schedule");
  assert.equal(gapPage("audience", links, "https://doma.xyz", new Set()), "https://doma.xyz/x");
  assert.equal(gapPage("competitor", links, "https://doma.xyz", new Set()), null);
});

test("adds industry terms to gap searches", () => {
  const context = { brand: "Doma", industry: "DomainFi", website: "https://doma.xyz" };
  assert.equal(gapSearchQuery("competitor", context), "Doma DomainFi competitors and alternatives");
  assert.equal(gapSearchQuery("pricing", context), "Doma pricing fees");
  assert.equal(gapSearchQuery("company", context), null);
});

test("discovery fills fact gaps with a site page and a web search, and records each step", async () => {
  process.env.FIRECRAWL_API_KEY = "fc-test";
  const pages = {
    "https://doma.xyz": "## Protocol\nDoma tokenizes DNS domains so they can be traded onchain while staying DNS-compliant.\n\n## Who it is for\nDomain investors and flippers trade names as tokens on Doma.",
    "https://doma.xyz/about": "## Launch partners\nDoma launched with D3 and a group of registrars as founding partners in 2025.",
    "https://doma.xyz/learn/fees": "## Fees\nListing a domain on Doma is free and every trade pays a one percent protocol fee."
  };
  const searches = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const endpoint = String(url).split("/v2/")[1];
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (endpoint === "map") {
      return json({ success: true, links: [{ url: "https://doma.xyz/about" }, { url: "https://doma.xyz/learn/fees" }] });
    }
    if (endpoint === "search") {
      searches.push(body.query);
      return json({ success: true, data: { web: [
        { url: "https://review.example/doma-alternatives", title: "Alternatives", markdown: "## Alternatives\nNamefi is a leading alternative to Doma for tokenizing domain names onchain." }
      ] } });
    }
    const markdown = pages[body.url];
    if (!markdown) return json({ success: false, error: "not found" }, 404);
    return json({ success: true, data: { markdown, metadata: { statusCode: 200, title: body.url } } });
  };

  const factsBySource = {
    "src-brand-site": [
      generated({ sectionId: "src-brand-site#protocol" }),
      generated({ category: "audience", statement: "Doma is for domain investors and flippers.", sectionId: "src-brand-site#who-it-is-for", quote: "Domain investors and flippers trade names as tokens on Doma" })
    ],
    "src-site-page-1": [
      generated({ category: "proof", statement: "Doma launched with D3 and registrars as partners.", entity: "D3", sectionId: "src-site-page-1#launch-partners", quote: "Doma launched with D3 and a group of registrars as founding partners in 2025" })
    ],
    "src-site-page-2": [
      generated({ category: "pricing", statement: "Trades on Doma pay a one percent protocol fee.", sectionId: "src-site-page-2#fees", quote: "every trade pays a one percent protocol fee", timeSensitive: true })
    ],
    "src-search-1": [
      generated({ category: "competitor", statement: "Namefi is an alternative to Doma.", entity: "Namefi", sectionId: "src-search-1#alternatives", quote: "Namefi is a leading alternative to Doma for tokenizing domain names onchain" })
    ]
  };
  const model = {
    async inferBrief() {
      return { brand: "Doma", industry: "DomainFi", audience: "Domain investors", tone: "Direct", competitors: [] };
    },
    async extractFacts(_context, src) {
      return factsBySource[src.id] ?? [];
    }
  };

  const result = await discoverBrief({
    website: "https://doma.xyz",
    goal: "Onboard domain flippers onchain",
    brand: "", industry: "", audience: "", tone: "", docs: "", competitors: [],
    platforms: ["X"], editorialProfile: "balanced", durationDays: 30, postsPerWeek: 5, teamSize: 1, hoursPerWeek: 8, restrictions: ""
  }, model);

  assert.deepEqual(searches, ["Doma DomainFi competitors and alternatives"]);
  assert.deepEqual(result.factSheet.gaps, []);
  assert.deepEqual(result.factSheet.facts.map((fact) => fact.category), ["product", "audience", "proof", "pricing", "competitor"]);
  assert.deepEqual(result.factSheet.discoverySteps.map((step) => [step.reason, step.method, step.target, step.outcome]), [
    ["pricing gap", "site-page", "https://doma.xyz/learn/fees", "Added 1 fact"],
    ["competitor gap", "web-search", "Doma DomainFi competitors and alternatives", "Added 1 fact"]
  ]);
  assert.deepEqual(result.brief.competitors, ["Namefi"]);
  assert.ok(result.inferredFields.includes("competitors"));
  assert.ok(result.sources.some((item) => item.id === "src-search-1" && item.authority === "third-party"));
});

test("discovery keeps one copy of a page that several gap searches return", async () => {
  process.env.FIRECRAWL_API_KEY = "fc-test";
  const searches = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const endpoint = String(url).split("/v2/")[1];
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (endpoint === "map") return json({ success: true, links: [] });
    if (endpoint === "search") {
      searches.push(body.query);
      return json({ success: true, data: { web: [
        { url: "https://www.halborn.com/case-studies/doma", title: "Halborn", markdown: "## Audit\nHalborn reviewed the Doma architecture before its mainnet launch in 2025." }
      ] } });
    }
    if (body.url === "https://doma.xyz") {
      return json({ success: true, data: { markdown: "## Protocol\nDoma tokenizes DNS domains so they can be traded onchain while staying DNS-compliant.", metadata: { statusCode: 200 } } });
    }
    return json({ success: false, error: "not found" }, 404);
  };
  const model = {
    async inferBrief() {
      return { brand: "Doma", industry: "DomainFi", audience: "Domain investors", tone: "Direct", competitors: [] };
    },
    async extractFacts(_context, src) {
      return src.id === "src-brand-site" ? [generated({ sectionId: "src-brand-site#protocol" })] : [];
    }
  };

  const result = await discoverBrief({
    website: "https://doma.xyz",
    goal: "Onboard domain flippers onchain",
    brand: "", industry: "", audience: "", tone: "", docs: "", competitors: [],
    platforms: ["X"], editorialProfile: "balanced", durationDays: 30, postsPerWeek: 5, teamSize: 1, hoursPerWeek: 8, restrictions: ""
  }, model);

  assert.deepEqual(searches, [
    "Doma DomainFi competitors and alternatives",
    "Doma DomainFi partners customers announcement",
    "Doma pricing fees"
  ], "competitor, proof and pricing get the three searches; audience waits");
  const halborn = result.sources.filter((source) => source.url === "https://www.halborn.com/case-studies/doma");
  assert.equal(halborn.length, 1);
  assert.deepEqual(result.factSheet.discoverySteps.map((step) => step.sourceIds.length), [1, 0, 0]);
});
