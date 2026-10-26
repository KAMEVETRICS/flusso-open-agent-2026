/* global Response */
import assert from "node:assert/strict";
import process from "node:process";
import test, { afterEach, beforeEach } from "node:test";
import { firecrawlMap, firecrawlScrape, firecrawlSearch } from "../lib/firecrawl.ts";

const originalFetch = globalThis.fetch;

function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return calls;
}

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = "fc-test";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("scrapes markdown through the v2 API with bearer auth", async () => {
  const calls = stubFetch(200, {
    success: true,
    data: {
      markdown: "# Arc House\nStablecoin rails.",
      metadata: { title: ["Arc House", "ignored"], description: "Rails", sourceURL: "https://arc.house", statusCode: 200 }
    }
  });

  const page = await firecrawlScrape("https://arc.house");
  assert.equal(calls[0].url, "https://api.firecrawl.dev/v2/scrape");
  assert.equal(calls[0].init.headers.Authorization, "Bearer fc-test");
  assert.deepEqual(calls[0].body.formats, ["markdown"]);
  assert.equal(calls[0].body.onlyMainContent, true);
  assert.deepEqual(page, {
    url: "https://arc.house",
    title: "Arc House",
    description: "Rails",
    markdown: "# Arc House\nStablecoin rails.",
    contentType: "",
    rawHtml: "",
    branding: null
  });
});

test("requests and returns the branding profile when asked", async () => {
  const calls = stubFetch(200, {
    success: true,
    data: { markdown: "Home", branding: { colors: { primary: "#0A84FF" } }, metadata: { statusCode: 200 } }
  });

  const page = await firecrawlScrape("https://arc.house", { branding: true });
  assert.deepEqual(calls[0].body.formats, ["markdown", "branding"]);
  assert.deepEqual(page.branding, { colors: { primary: "#0A84FF" } });
});

test("treats an upstream error status as a failed scrape", async () => {
  stubFetch(200, { success: true, data: { markdown: "Not found", metadata: { statusCode: 404 } } });
  await assert.rejects(firecrawlScrape("https://arc.house/missing"), /HTTP 404/);
});

test("surfaces Firecrawl error messages", async () => {
  stubFetch(402, { success: false, error: "Insufficient credits" });
  await assert.rejects(firecrawlScrape("https://arc.house"), /Firecrawl scrape failed: Insufficient credits/);
});

test("falls back to the HTTP status for non-JSON errors", async () => {
  stubFetch(502, "<html>Bad gateway</html>");
  await assert.rejects(firecrawlScrape("https://arc.house"), /Firecrawl scrape failed: HTTP 502/);
});

test("maps link objects and tolerates bare strings", async () => {
  const calls = stubFetch(200, {
    success: true,
    links: [{ url: "https://arc.house/about", title: "About" }, "https://arc.house/pricing", { title: "no url" }]
  });

  const links = await firecrawlMap("https://arc.house", 200);
  assert.equal(calls[0].body.limit, 200);
  assert.deepEqual(links.map((link) => link.url), ["https://arc.house/about", "https://arc.house/pricing"]);
});

test("returns scraped web search results", async () => {
  const calls = stubFetch(200, {
    success: true,
    data: { web: [{ url: "https://review.example/arc-alternatives", title: "Arc alternatives", markdown: "Circle and Bridge" }] }
  });

  const results = await firecrawlSearch("arc.house competitors and alternatives", 3);
  assert.equal(calls[0].url, "https://api.firecrawl.dev/v2/search");
  assert.deepEqual(calls[0].body.sources, ["web"]);
  assert.equal(results[0].markdown, "Circle and Bridge");
});

test("refuses to call Firecrawl without an API key", async () => {
  delete process.env.FIRECRAWL_API_KEY;
  stubFetch(200, { success: true });
  await assert.rejects(firecrawlScrape("https://arc.house"), /FIRECRAWL_API_KEY is missing/);
});

test("retries a request whose connection fails, but not an HTTP error", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) throw new TypeError("fetch failed");
    return new Response(JSON.stringify({ success: true, data: { markdown: "Home", metadata: { statusCode: 200 } } }), { status: 200 });
  };
  const page = await firecrawlScrape("https://doma.xyz");
  assert.equal(page.markdown, "Home");
  assert.equal(attempts, 2);

  attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ success: false, error: "Payment required" }), { status: 402 });
  };
  await assert.rejects(firecrawlScrape("https://doma.xyz"), /Payment required/);
  assert.equal(attempts, 1);
});
