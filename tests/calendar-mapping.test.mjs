import assert from "node:assert/strict";
import test from "node:test";
import { assignAssetsToDays } from "../lib/calendar-mapping.ts";

const days = [
  { id: "cal-1", platform: "LinkedIn", format: "short-post", contentItemId: "item-1" },
  { id: "cal-2", platform: "X", format: "thread", contentItemId: "item-2" },
  { id: "cal-3", platform: "X", format: "short-post", contentItemId: "item-1" },
  { id: "cal-4", platform: "LinkedIn", format: "article", contentItemId: "" }
];

function asset(id, calendarItemId, platform, contentItemId = "item-1") {
  return { id, calendarItemId, platform, contentItemId, contentFormat: "short-post" };
}

test("keeps valid mappings and moves duplicates and blanks to free days", () => {
  const { assets, days: nextDays, moved } = assignAssetsToDays([
    asset("asset-1", "cal-1", "LinkedIn"),
    asset("asset-2", "cal-1", "X"),
    asset("asset-3", "", "LinkedIn", "item-2")
  ], days);
  assert.deepEqual(assets.map((item) => item.calendarItemId), ["cal-1", "cal-3", "cal-4"]);
  assert.deepEqual(moved, ["asset-2 -> cal-3", "asset-3 -> cal-4"]);
  assert.equal(nextDays[2].platform, "X");
});

test("retargets a free day on another platform rather than changing the asset", () => {
  const { assets, days: nextDays } = assignAssetsToDays([
    asset("asset-1", "cal-2", "X"),
    asset("asset-2", "cal-3", "X"),
    asset("asset-3", "cal-2", "X")
  ], days.slice(0, 3));
  assert.equal(assets[2].calendarItemId, "cal-1");
  assert.equal(assets[2].platform, "X");
  assert.deepEqual([nextDays[0].platform, nextDays[0].format], ["X", "short-post"]);
});
