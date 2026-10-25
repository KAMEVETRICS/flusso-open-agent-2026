/* global URL */
import type { BrandFact, FactCategory, SourceDocument } from "./schemas";
import { isSameSiteFamily, type SiteLink } from "./discovery-helpers";
import { isEvidenceSource } from "./proof";
import { plainText, sectionContaining, splitIntoSections, type SourceSection } from "./sections";
import { excerptAppearsIn, normalizeForMatch } from "./text-match";

// Discovery keeps looking until each of these has at least one verified fact, within its budget.
export const REQUIRED_FACT_CATEGORIES: FactCategory[] = ["product", "audience", "proof", "pricing", "competitor"];
const CATEGORY_ORDER: FactCategory[] = [...REQUIRED_FACT_CATEGORIES, "company"];
const MAX_EXTRACTION_CHARS = 30_000;

export type FactContext = { brand: string; industry: string; website: string };

export type GeneratedFact = {
  category: FactCategory;
  statement: string;
  entity: string;
  sectionId: string;
  quote: string;
  timeSensitive: boolean;
};

export type UnnumberedFact = Omit<BrandFact, "id">;

export function isFactSource(source: SourceDocument) {
  return isEvidenceSource(source) && source.sourceType !== "user-note";
}

// Sections to read from one source. Passages already read in an earlier source are skipped,
// because sites repeat navigation and app screens on every page.
export function extractionSections(source: SourceDocument, seen: Set<string>): SourceSection[] {
  const picked: SourceSection[] = [];
  let size = 0;
  for (const section of splitIntoSections(source)) {
    const key = normalizeForMatch(plainText(section.text));
    if (!key || seen.has(key)) continue;
    if (size + section.text.length > MAX_EXTRACTION_CHARS) break;
    seen.add(key);
    picked.push(section);
    size += section.text.length;
  }
  return picked;
}

// Keeps a proposed fact only when its quote appears in the source, preferring the cited section.
export function verifyFacts(
  generated: GeneratedFact[],
  source: SourceDocument,
  offered: SourceSection[],
  brand: string
): { facts: UnnumberedFact[]; rejected: number } {
  const offeredById = new Map(offered.map((section) => [section.id, section]));
  const allSections = splitIntoSections(source);
  const brandKey = brand.trim().toLowerCase();
  const facts: UnnumberedFact[] = [];
  let rejected = 0;

  for (const fact of generated) {
    const statement = fact.statement.trim();
    const quote = fact.quote.trim();
    const entity = fact.entity.trim();
    const cited = offeredById.get(fact.sectionId);
    const section = cited && excerptAppearsIn(quote, cited.text) ? cited : sectionContaining(allSections, quote);
    const namesBrand = Boolean(brandKey) && entity.toLowerCase() === brandKey;
    if (!statement || !section || (fact.category === "competitor" && (!entity || namesBrand))) {
      rejected += 1;
      continue;
    }
    facts.push({
      category: fact.category,
      statement,
      entity,
      sourceId: source.id,
      sectionId: section.id,
      quote,
      authority: source.authority,
      timeSensitive: fact.timeSensitive
    });
  }
  return { facts, rejected };
}

// Drops repeated statements, groups facts by category, and numbers them fact-1, fact-2, and so on.
export function numberFacts(facts: UnnumberedFact[]): BrandFact[] {
  const seen = new Set<string>();
  const unique = facts.filter((fact) => {
    const key = fact.category + ":" + normalizeForMatch(fact.statement);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique
    .map((fact, index) => ({ fact, index }))
    .sort((left, right) =>
      CATEGORY_ORDER.indexOf(left.fact.category) - CATEGORY_ORDER.indexOf(right.fact.category) || left.index - right.index
    )
    .map(({ fact }, index) => ({ id: "fact-" + (index + 1), ...fact }));
}

export function factGaps(facts: Array<Pick<BrandFact, "category">>): FactCategory[] {
  return REQUIRED_FACT_CATEGORIES.filter((category) => !facts.some((fact) => fact.category === category));
}

export function competitorNames(facts: BrandFact[]) {
  const seen = new Set<string>();
  return facts
    .filter((fact) => fact.category === "competitor" && fact.entity)
    .map((fact) => fact.entity)
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Comparison key for pages: host without www plus path without a trailing slash.
export function pageKey(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.toLowerCase().replace(/^www\./, "") + url.pathname.replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

const GAP_PAGE_SEGMENTS: Partial<Record<FactCategory, string[]>> = {
  product: ["features", "product", "products", "platform", "how-it-works", "protocol", "docs", "documentation"],
  audience: ["use-cases", "solutions", "customers", "industries", "who-its-for"],
  pricing: ["pricing", "plans", "fees", "fee-schedule"],
  proof: ["customers", "case-studies", "partners", "ecosystem", "press", "news", "announcements", "blog"]
};

// The shallowest unread page on the brand's own site whose path or link title fits the category.
export function gapPage(category: FactCategory, links: SiteLink[], website: string, taken: Set<string>) {
  const keywords = GAP_PAGE_SEGMENTS[category];
  if (!keywords) return null;
  const candidates = links.flatMap((link) => {
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      return [];
    }
    const key = pageKey(link.url);
    if (!isSameSiteFamily(link.url, website) || taken.has(key)) return [];
    const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
    const title = (link.title ?? "").toLowerCase();
    const fits = keywords.some((keyword) => segments.includes(keyword) || title.includes(keyword.replace(/-/g, " ")));
    return fits ? [{ url: url.origin + url.pathname.replace(/\/+$/, ""), depth: segments.length }] : [];
  });
  candidates.sort((left, right) => left.depth - right.depth);
  return candidates[0]?.url ?? null;
}

// Web search for a category the site does not answer. Industry terms keep the search on the
// brand's market rather than unrelated companies with a similar name.
export function gapSearchQuery(category: FactCategory, context: FactContext) {
  const subject = (context.brand + " " + context.industry).trim();
  const queries: Partial<Record<FactCategory, string>> = {
    competitor: subject + " competitors and alternatives",
    proof: subject + " partners customers announcement",
    pricing: context.brand + " pricing fees",
    audience: subject + " use cases",
    product: context.brand + " how it works"
  };
  return queries[category] ?? null;
}
