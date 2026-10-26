import type { CalendarItem, ContentAsset } from "./schemas";

type MappableAsset = Pick<ContentAsset, "id" | "calendarItemId" | "contentItemId" | "platform" | "contentFormat">;
type MappableDay = Pick<CalendarItem, "id" | "platform" | "format" | "contentItemId">;

// Gives every asset its own calendar day. The model sometimes leaves an asset unmapped or puts two
// on one day; those move to a free day, preferring the same content item and platform. When only a
// day on another platform is free, that day takes the asset's platform and format, so the drafted
// asset itself never changes.
export function assignAssetsToDays<A extends MappableAsset, D extends MappableDay>(
  assets: A[],
  days: D[]
): { assets: A[]; days: D[]; moved: string[] } {
  const dayIds = new Set(days.map((day) => day.id));
  const taken = new Set<string>();
  const needsDay: number[] = [];
  const nextAssets = assets.map((asset, index) => {
    if (asset.calendarItemId && dayIds.has(asset.calendarItemId) && !taken.has(asset.calendarItemId)) {
      taken.add(asset.calendarItemId);
      return asset;
    }
    needsDay.push(index);
    return asset;
  });
  const nextDays = [...days];
  const moved: string[] = [];

  for (const index of needsDay) {
    const asset = nextAssets[index];
    const free = nextDays.filter((day) => !taken.has(day.id));
    const day =
      free.find((item) => item.platform === asset.platform && item.contentItemId === asset.contentItemId) ??
      free.find((item) => item.platform === asset.platform) ??
      free[0];
    if (!day) continue;
    taken.add(day.id);
    if (day.platform !== asset.platform) {
      const position = nextDays.indexOf(day);
      nextDays[position] = { ...day, platform: asset.platform, format: asset.contentFormat };
    }
    nextAssets[index] = { ...asset, calendarItemId: day.id };
    moved.push(asset.id + " -> " + day.id);
  }
  return { assets: nextAssets, days: nextDays, moved };
}
