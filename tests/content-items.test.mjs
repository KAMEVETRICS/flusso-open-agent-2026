import assert from "node:assert/strict";
import test from "node:test";
import { normalizeContentItems, unrenderedItems } from "../lib/content-items.ts";

const context = {
  platforms: ["X", "LinkedIn"],
  segmentIds: new Set(["segment-1"]),
  territoryIds: new Set(["territory-1"]),
  seriesIds: new Set(["series-1"]),
  factIds: new Set(["fact-1", "fact-2"]),
  hookIdMap: new Map([["hook-1", "hook-1"], ["hook-3", "hook-2"]]),
  assetTarget: 4
};

function item(overrides) {
  return {
    id: "x",
    coreMessage: "Tokenized domains settle trades in minutes instead of the days a registrar transfer takes.",
    segmentId: "segment-1",
    territoryId: "territory-1",
    seriesId: "series-1",
    hookId: "hook-1",
    factIds: ["fact-1"],
    platforms: ["X", "LinkedIn"],
    ...overrides
  };
}

test("numbers items and keeps only references that resolve", () => {
  const { items, warnings } = normalizeContentItems([
    item({ id: "a" }),
    item({
      id: "b",
      coreMessage: "Registrars stay in the loop, so a tokenized name still resolves like any other domain.",
      segmentId: "segment-9",
      seriesId: "series-4",
      hookId: "hook-3",
      factIds: ["fact-2", "fact-7", "fact-2"],
      platforms: ["LinkedIn", "Medium", "LinkedIn"]
    })
  ], context);

  assert.deepEqual(items.map((entry) => entry.id), ["item-1", "item-2"]);
  assert.deepEqual(
    { segmentId: items[1].segmentId, seriesId: items[1].seriesId, hookId: items[1].hookId, factIds: items[1].factIds, platforms: items[1].platforms },
    { segmentId: "", seriesId: "", hookId: "hook-2", factIds: ["fact-2"], platforms: ["LinkedIn"] }
  );
  assert.deepEqual(warnings, ["Content items plan 3 renditions for 4 assets."]);
});

test("flags items that make the same point and items with no platform", () => {
  const { warnings } = normalizeContentItems([
    item({}),
    item({ coreMessage: "Tokenized domains settle trades in minutes instead of the days registrar transfers take.", platforms: [] }),
    item({ coreMessage: "A completely different point about registrars.", hookId: "hook-2" })
  ], { ...context, assetTarget: 4 });
  assert.deepEqual(warnings, ["item-2 repeats the point of item-1.", "item-2 has no planned platform."]);
});

test("lists content items no asset renders", () => {
  const items = [{ id: "item-1" }, { id: "item-2" }, { id: "item-3" }];
  assert.deepEqual(unrenderedItems(items, [{ contentItemId: "item-1" }, { contentItemId: "item-3" }]), ["item-2"]);
});
