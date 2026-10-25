/* global Response */
import assert from "node:assert/strict";
import process from "node:process";
import test, { afterEach, beforeEach } from "node:test";
import { searchSourceDocuments } from "../lib/source-ingestion.ts";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = "fc-test";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("labels search results from the brand's own subdomains as first-party", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    data: {
      web: [
        { url: "https://blog.doma.xyz/launch", title: "Doma blog", markdown: "Doma launches domain trading." },
        { url: "https://www.g2.com/products/doma", title: "G2", markdown: "Reviews of an unrelated Doma." },
        { url: "https://notdoma.xyz/", title: "Lookalike", markdown: "A different company." }
      ]
    }
  }), { status: 200 });

  const sources = await searchSourceDocuments("doma.xyz competitors", "https://doma.xyz", 5, "2026-10-25T00:00:00.000Z");
  assert.deepEqual(sources.map((source) => [source.url, source.authority]), [
    ["https://blog.doma.xyz/launch", "first-party"],
    ["https://www.g2.com/products/doma", "third-party"],
    ["https://notdoma.xyz/", "third-party"]
  ]);
});
