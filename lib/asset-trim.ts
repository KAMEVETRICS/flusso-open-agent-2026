// Chooses which assets to keep when Execution drafts more than the cadence allows. Each planned
// rendition (a content item on a platform) keeps its first asset before any duplicate is kept,
// so a surplus copy never pushes out a required platform or content item.
export function keepPlannedAssets<T extends { contentItemId: string; platform: string }>(
  assets: T[],
  target: number,
  plannedItemIds: Set<string>
): T[] {
  const renditionKey = (asset: T) => asset.contentItemId + "\u0000" + asset.platform;
  const kept: T[] = [];
  const seen = new Set<string>();
  const pass = (accept: (asset: T) => boolean) => {
    for (const asset of assets) {
      if (kept.length >= target) return;
      if (kept.includes(asset) || !accept(asset)) continue;
      kept.push(asset);
      seen.add(renditionKey(asset));
    }
  };
  // First the planned renditions, then any other new rendition, then duplicates.
  pass((asset) => plannedItemIds.has(asset.contentItemId) && !seen.has(renditionKey(asset)));
  pass((asset) => !seen.has(renditionKey(asset)));
  pass(() => true);
  // Keep the model's order among the survivors.
  return assets.filter((asset) => kept.includes(asset));
}
