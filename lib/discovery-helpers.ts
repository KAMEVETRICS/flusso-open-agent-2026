/* global URL */
import type { BriefInput, ProjectBrief } from "./schemas";

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

export function pickKeyPages(links: string[], website: string, max: number) {
  const site = new URL(website);
  const host = hostKey(site.hostname);
  const homePath = site.pathname.replace(/\/+$/, "").toLowerCase();
  const bestByGroup = new Map<number, { url: string; depth: number }>();

  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || hostKey(url.hostname) !== host) continue;

    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    if (!path || path === homePath || ASSET_PATH.test(path)) continue;

    const segments = path.split("/").filter(Boolean);
    const group = KEY_PAGE_GROUPS.findIndex((terms) => terms.some((term) => segments.includes(term)));
    if (group < 0) continue;

    const candidate = { url: url.origin + url.pathname.replace(/\/+$/, ""), depth: segments.length };
    const current = bestByGroup.get(group);
    if (
      !current ||
      candidate.depth < current.depth ||
      (candidate.depth === current.depth && candidate.url.length < current.url.length)
    ) {
      bestByGroup.set(group, candidate);
    }
  }

  return Array.from(bestByGroup.entries())
    .sort(([left], [right]) => left - right)
    .map(([, page]) => page.url)
    .slice(0, max);
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
