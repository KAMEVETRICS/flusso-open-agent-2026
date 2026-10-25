/* global URL */
import type { BriefInput, ProjectBrief } from "./schemas";
import { asRecord, type JsonRecord } from "./json-values";

export const INFERABLE_FIELDS = ["brand", "industry", "audience", "tone"] as const;
export type InferableField = (typeof INFERABLE_FIELDS)[number];

export type BriefInference = {
  brand: string;
  industry: string;
  audience: string;
  tone: string;
  competitors: string[];
};

const MAX_INFERRED_COMPETITORS = 6;

// One page is taken per group, in this priority order.
const KEY_PAGE_GROUPS = [
  ["about", "company", "mission"],
  ["product", "products", "platform", "features", "solutions", "how-it-works"],
  ["use-cases", "customers", "case-studies"],
  ["pricing", "plans"],
  ["docs", "documentation", "developers"]
];

const ASSET_PATH = /\.(?:png|jpe?g|gif|svg|webp|ico|css|js|json|xml|txt|zip)$/;

// Pages that rarely describe the brand: legal, account, hiring, and listing pages.
const EXCLUDED_SEGMENTS = new Set([
  "privacy", "privacy-policy", "terms", "terms-of-service", "tos", "legal", "cookies", "cookie-policy",
  "login", "log-in", "signin", "sign-in", "signup", "sign-up", "register", "careers", "jobs",
  "blog", "news", "press", "status", "contact", "support", "help", "search", "tag", "tags",
  "category", "author"
]);

// schema.org types that describe the brand, its products, and its offers.
const STRUCTURED_DATA_TYPES = new Set([
  "Organization", "Corporation", "NGO", "LocalBusiness", "Brand", "Product", "Service",
  "SoftwareApplication", "WebApplication", "MobileApplication", "Offer", "AggregateOffer",
  "FAQPage", "WebSite"
]);
const STRUCTURED_DATA_DROPPED_KEYS = new Set(["@context", "@id", "image", "logo", "potentialAction", "thumbnailUrl"]);
const MAX_STRUCTURED_ENTITIES = 12;

export type SiteLink = { url: string; title?: string };

export function isLikelyUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeWebsite(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
  return "https://" + trimmed;
}

export function splitSourceUrls(value: string) {
  return value
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter((item) => item && isLikelyUrl(item));
}

function hostKey(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function competitorSearchQuery(website: string) {
  return hostKey(new URL(website).hostname) + " competitors and alternatives";
}

// True for the website's own host and its subdomains (docs.example.com for example.com).
export function isSameSiteFamily(url: string, website: string) {
  try {
    const base = hostKey(new URL(website).hostname);
    const host = hostKey(new URL(url).hostname);
    return host === base || host.endsWith("." + base);
  } catch {
    return false;
  }
}

type PageCandidate = { url: string; key: string; host: string; segments: string[]; titleSlug: string };

function pageCandidate(link: SiteLink): PageCandidate | null {
  let url: URL;
  try {
    url = new URL(link.url);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const path = url.pathname.replace(/\/+$/, "");
  const lowerPath = path.toLowerCase();
  const segments = lowerPath.split("/").filter(Boolean);
  if (ASSET_PATH.test(lowerPath) || segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return null;
  const host = hostKey(url.hostname);
  return {
    url: url.origin + path,
    key: host + lowerPath,
    host,
    segments,
    titleSlug: (link.title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
  };
}

// Chooses pages to scrape: links the brand lists in llms.txt first, then one page per keyword group
// (matched on path or link title), then top-level pages when keywords find nothing.
export function pickKeyPages(
  links: SiteLink[],
  website: string,
  max: number,
  preferred: string[] = [],
  exclude: string[] = []
) {
  const site = new URL(website);
  const host = hostKey(site.hostname);
  const seen = new Set([host + site.pathname.replace(/\/+$/, "").toLowerCase()]);
  for (const url of exclude) {
    const candidate = pageCandidate({ url });
    if (candidate) seen.add(candidate.key);
  }
  const picks: string[] = [];
  // The homepage is pre-seeded in `seen`; roots of other subdomains (docs.example.com) stay eligible.
  const take = (candidate: PageCandidate) => {
    if (picks.length >= max || seen.has(candidate.key)) return;
    seen.add(candidate.key);
    picks.push(candidate.url);
  };

  for (const url of preferred) {
    const candidate = pageCandidate({ url });
    if (candidate && isSameSiteFamily(candidate.url, website)) take(candidate);
  }

  const sameHost = links
    .map(pageCandidate)
    .filter((candidate): candidate is PageCandidate => candidate !== null && candidate.host === host);
  const bestByGroup = new Map<number, PageCandidate>();
  for (const candidate of sameHost) {
    const titled = "-" + candidate.titleSlug + "-";
    const group = KEY_PAGE_GROUPS.findIndex((terms) =>
      terms.some((term) => candidate.segments.includes(term) || titled.includes("-" + term + "-"))
    );
    if (group < 0) continue;
    const current = bestByGroup.get(group);
    if (
      !current ||
      candidate.segments.length < current.segments.length ||
      (candidate.segments.length === current.segments.length && candidate.url.length < current.url.length)
    ) {
      bestByGroup.set(group, candidate);
    }
  }
  Array.from(bestByGroup.entries())
    .sort(([left], [right]) => left - right)
    .forEach(([, candidate]) => take(candidate));

  sameHost.filter((candidate) => candidate.segments.length === 1).forEach(take);
  return picks;
}

// Removes sections addressed to AI agents (some llms.txt files embed them); fetched text is data only.
export function stripAgentInstructions(text: string) {
  const kept: string[] = [];
  let skippingLevel = 0;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading) {
      const level = heading[1].length;
      if (skippingLevel && level <= skippingLevel) skippingLevel = 0;
      if (!skippingLevel && /\binstructions?\b/i.test(heading[2]) && /\b(?:agents?|llms?|ai|assistants?)\b/i.test(heading[2])) {
        skippingLevel = level;
        continue;
      }
    }
    if (!skippingLevel) kept.push(line);
  }
  return kept.join("\n");
}

// Links from an llms.txt file on the brand's own site family, keeping the file's order and
// placing links under an "Optional" heading last.
export function parseSiteIndexLinks(text: string, website: string) {
  const primary: string[] = [];
  const optional: string[] = [];
  let inOptional = false;
  for (const line of stripAgentInstructions(text).split(/\r?\n/)) {
    const section = /^##\s+(.*)$/.exec(line.trim());
    if (section) {
      inOptional = /^optional\b/i.test(section[1].trim());
      continue;
    }
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)|(?<![(\w])(https?:\/\/[^\s)<>\]"']+)/g)) {
      const target = (match[1] ?? match[2]).replace(/[.,;:]+$/, "");
      let url: string;
      try {
        url = new URL(target, website).href;
      } catch {
        continue;
      }
      if (isSameSiteFamily(url, website)) (inOptional ? optional : primary).push(url);
    }
  }
  return Array.from(new Set([...primary, ...optional]));
}

function pruneStructuredValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) return depth > 3 ? [] : value.slice(0, 20).map((item) => pruneStructuredValue(item, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 3) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !STRUCTURED_DATA_DROPPED_KEYS.has(key))
        .map(([key, item]) => [key, pruneStructuredValue(item, depth + 1)])
    );
  }
  return value;
}

// schema.org JSON-LD entities a site publishes about itself. They are self-asserted evidence.
export function extractStructuredData(rawHtml: string): JsonRecord[] {
  const entities: JsonRecord[] = [];
  for (const match of rawHtml.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length && entities.length < MAX_STRUCTURED_ENTITIES) {
      const item = asRecord(queue.shift());
      if (Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
      const types = [item["@type"]].flat().filter((type): type is string => typeof type === "string");
      if (types.some((type) => STRUCTURED_DATA_TYPES.has(type))) {
        entities.push(asRecord(pruneStructuredValue(item, 0)));
      }
    }
  }
  return entities;
}

export function missingBriefFields(input: BriefInput): InferableField[] {
  return INFERABLE_FIELDS.filter((field) => !input[field].trim());
}

export function mergeInferredBrief(
  input: BriefInput,
  inferred: BriefInference | null
): { brief: ProjectBrief; inferredFields: string[] } {
  const inferredFields: string[] = [];
  const pick = (field: InferableField) => {
    const stated = input[field].trim();
    if (stated) return stated;
    const value = inferred?.[field]?.trim() ?? "";
    if (value) inferredFields.push(field);
    return value;
  };

  const brand = pick("brand");
  const industry = pick("industry");
  const audience = pick("audience");
  const tone = pick("tone");

  let competitors = input.competitors.map((item) => item.trim()).filter(Boolean);
  if (!competitors.length && inferred) {
    const seen = new Set([brand.toLowerCase()]);
    competitors = [];
    for (const name of inferred.competitors) {
      const trimmed = name.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) continue;
      seen.add(key);
      competitors.push(trimmed);
    }
    competitors = competitors.slice(0, MAX_INFERRED_COMPETITORS);
    if (competitors.length) inferredFields.push("competitors");
  }

  return {
    brief: { ...input, brand, industry, audience, tone, competitors },
    inferredFields
  };
}
