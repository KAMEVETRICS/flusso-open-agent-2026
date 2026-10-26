import type { ContentItem, Platform } from "./schemas";
import { hookSimilarity } from "./editorial-policy";

// Core messages this similar make the same point twice.
const REPEATED_MESSAGE_SIMILARITY = 0.6;
// A bracketed reference such as "[src-project-docs]" or "(fact-3)". Facts are linked through
// factIds; the core message is client-facing.
const INTERNAL_REFERENCE = /\s*[[(](?:src|fact|claim|item|hook|segment|territory|series)-[^\])]*[\])]/g;

export type ContentItemContext = {
  platforms: Platform[];
  segmentIds: Set<string>;
  territoryIds: Set<string>;
  seriesIds: Set<string>;
  factIds: Set<string>;
  // Maps hook IDs the writer used to the IDs that survived the hook review.
  hookIdMap: Map<string, string>;
  assetTarget: number;
};

// Numbers items item-1, item-2, ..., keeps only references that resolve, and reports items that
// repeat another item's point or plans whose renditions do not add up to the asset count.
export function normalizeContentItems(
  items: ContentItem[],
  context: ContentItemContext
): { items: ContentItem[]; warnings: string[] } {
  const selected = new Set<Platform>(context.platforms);
  const warnings: string[] = [];
  const normalized = items.map((item, index): ContentItem => ({
    id: "item-" + (index + 1),
    coreMessage: (() => {
      const cleaned = item.coreMessage.replace(INTERNAL_REFERENCE, "").trim();
      if (cleaned !== item.coreMessage.trim()) warnings.push("item-" + (index + 1) + " cited internal IDs in its core message; they were removed.");
      return cleaned;
    })(),
    segmentId: context.segmentIds.has(item.segmentId) ? item.segmentId : "",
    territoryId: context.territoryIds.has(item.territoryId) ? item.territoryId : "",
    seriesId: context.seriesIds.has(item.seriesId) ? item.seriesId : "",
    hookId: context.hookIdMap.get(item.hookId) ?? "",
    factIds: Array.from(new Set(item.factIds.filter((factId) => context.factIds.has(factId)))),
    platforms: Array.from(new Set(item.platforms.filter((platform) => selected.has(platform))))
  }));

  normalized.forEach((item, index) => {
    const earlier = normalized.slice(0, index).find(
      (other) => hookSimilarity(other.coreMessage, item.coreMessage) > REPEATED_MESSAGE_SIMILARITY
    );
    if (earlier) warnings.push(item.id + " repeats the point of " + earlier.id + ".");
    if (!item.platforms.length) warnings.push(item.id + " has no planned platform.");
  });
  const renditions = normalized.reduce((sum, item) => sum + item.platforms.length, 0);
  if (renditions !== context.assetTarget) {
    warnings.push("Content items plan " + renditions + " renditions for " + context.assetTarget + " assets.");
  }
  return { items: normalized, warnings };
}

// Content items that no asset renders.
export function unrenderedItems(items: ContentItem[], assets: Array<{ contentItemId: string }>) {
  const rendered = new Set(assets.map((asset) => asset.contentItemId));
  return items.filter((item) => !rendered.has(item.id)).map((item) => item.id);
}
