/* global AbortSignal */
import process from "node:process";
import { asRecord, asText, type JsonRecord } from "./json-values";

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v2";
const SCRAPE_TIMEOUT_MS = 45_000;
const REQUEST_TIMEOUT_MS = 60_000;
const SEARCH_TIMEOUT_MS = 90_000;

export type FirecrawlPage = {
  url: string;
  title: string;
  description: string;
  markdown: string;
};

export type FirecrawlScrape = FirecrawlPage & {
  contentType: string;
  rawHtml: string;
  branding: JsonRecord | null;
};

export type FirecrawlLink = {
  url: string;
  title: string;
  description: string;
};

export function isFirecrawlConfigured() {
  return Boolean(process.env.FIRECRAWL_API_KEY?.trim());
}

function apiKey() {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) {
    throw new Error("FIRECRAWL_API_KEY is missing. Add it to .env.local and restart the server.");
  }
  return key;
}

const NETWORK_RETRIES = 2;
const RETRY_DELAY_MS = 750;

// fetch rejects with a TypeError when the connection itself fails ("fetch failed"). Retry those;
// HTTP errors and timeouts are not retried, because they are answers or already slow.
async function fetchWithRetry(url: string, init: RequestInit) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      if (attempt >= NETWORK_RETRIES || !(error instanceof TypeError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
}

async function post(endpoint: string, body: JsonRecord, timeoutMs: number): Promise<JsonRecord> {
  const response = await fetchWithRetry(FIRECRAWL_API_URL + endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });

  let payload: JsonRecord = {};
  try {
    payload = asRecord(JSON.parse(await response.text()));
  } catch {
    // Non-JSON error bodies fall through to the status-based message.
  }

  if (!response.ok || payload.success === false) {
    const detail = asText(payload.error) || "HTTP " + response.status;
    throw new Error("Firecrawl " + endpoint.slice(1) + " failed: " + detail);
  }
  return payload;
}

export async function firecrawlScrape(
  url: string,
  options: { branding?: boolean; rawHtml?: boolean } = {}
): Promise<FirecrawlScrape> {
  const formats = ["markdown"];
  if (options.branding) formats.push("branding");
  // Raw HTML keeps <head>, where sites publish their JSON-LD structured data.
  if (options.rawHtml) formats.push("rawHtml");
  const payload = await post("/scrape", {
    url,
    formats,
    onlyMainContent: true,
    timeout: SCRAPE_TIMEOUT_MS
  }, REQUEST_TIMEOUT_MS);
  const data = asRecord(payload.data);
  const metadata = asRecord(data.metadata);
  const statusCode = typeof metadata.statusCode === "number" ? metadata.statusCode : null;
  if (statusCode !== null && statusCode >= 400) {
    throw new Error("HTTP " + statusCode);
  }

  const branding = asRecord(data.branding);
  return {
    url: asText(metadata.url) || asText(metadata.sourceURL) || url,
    title: asText(metadata.title),
    description: asText(metadata.description),
    markdown: asText(data.markdown),
    contentType: asText(metadata.contentType),
    rawHtml: typeof data.rawHtml === "string" ? data.rawHtml : "",
    branding: Object.keys(branding).length ? branding : null
  };
}

export async function firecrawlMap(url: string, limit: number): Promise<FirecrawlLink[]> {
  const payload = await post("/map", {
    url,
    limit,
    includeSubdomains: false,
    ignoreQueryParameters: true
  }, REQUEST_TIMEOUT_MS);
  const links = Array.isArray(payload.links) ? payload.links : [];

  return links
    .map((link) => {
      // The v2 API returns objects; accept bare strings defensively.
      if (typeof link === "string") return { url: link, title: "", description: "" };
      const item = asRecord(link);
      return { url: asText(item.url), title: asText(item.title), description: asText(item.description) };
    })
    .filter((link) => link.url);
}

export async function firecrawlSearch(query: string, limit: number): Promise<FirecrawlPage[]> {
  const payload = await post("/search", {
    query,
    limit,
    sources: ["web"],
    scrapeOptions: {
      formats: [{ type: "markdown" }],
      onlyMainContent: true
    }
  }, SEARCH_TIMEOUT_MS);
  const data = asRecord(payload.data);
  const results = Array.isArray(data.web) ? data.web : [];

  return results
    .map((result) => {
      const item = asRecord(result);
      return {
        url: asText(item.url),
        title: asText(item.title),
        description: asText(item.description),
        markdown: asText(item.markdown)
      };
    })
    .filter((result) => result.url);
}

const PARSE_TIMEOUT_MS = 120_000;

// Converts an uploaded file (PDF, DOCX, PPTX, and similar) to markdown with Firecrawl /parse.
export async function firecrawlParse(file: Blob, filename: string): Promise<{ markdown: string; title: string }> {
  const form = new FormData();
  form.append("file", file, filename);
  form.append("options", new Blob([JSON.stringify({ formats: ["markdown"], timeout: PARSE_TIMEOUT_MS })], { type: "application/json" }));
  const response = await fetchWithRetry(FIRECRAWL_API_URL + "/parse", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey() },
    body: form,
    signal: AbortSignal.timeout(PARSE_TIMEOUT_MS + 15_000)
  });
  let payload: JsonRecord = {};
  try {
    payload = asRecord(JSON.parse(await response.text()));
  } catch {
    // Non-JSON error bodies fall through to the status-based message.
  }
  if (!response.ok || payload.success === false) {
    throw new Error("Firecrawl parse failed: " + (asText(payload.error) || "HTTP " + response.status));
  }
  const data = asRecord(payload.data);
  return { markdown: asText(data.markdown), title: asText(asRecord(data.metadata).title) };
}
