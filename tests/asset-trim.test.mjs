import assert from "node:assert/strict";
import test from "node:test";
import { keepPlannedAssets } from "../lib/asset-trim.ts";

const asset = (id, contentItemId, platform) => ({ id, contentItemId, platform });

test("a surplus duplicate is dropped before a planned rendition on another platform", () => {
  const kept = keepPlannedAssets(
    [asset("a1", "item-1", "X"), asset("a2", "item-1", "X"), asset("a3", "item-2", "LinkedIn")],
    2,
    new Set(["item-1", "item-2"])
  );
  assert.deepEqual(kept.map((a) => a.id), ["a1", "a3"]);
});

test("planned renditions come before unplanned ones, and the model's order is kept", () => {
  const kept = keepPlannedAssets(
    [asset("a1", "extra", "X"), asset("a2", "item-1", "Newsletter"), asset("a3", "item-2", "X"), asset("a4", "item-1", "Newsletter")],
    2,
    new Set(["item-1", "item-2"])
  );
  assert.deepEqual(kept.map((a) => a.id), ["a2", "a3"]);
});

test("duplicates fill the remaining slots only when nothing else is left", () => {
  const kept = keepPlannedAssets([asset("a1", "item-1", "X"), asset("a2", "item-1", "X"), asset("a3", "item-1", "X")], 2, new Set(["item-1"]));
  assert.deepEqual(kept.map((a) => a.id), ["a1", "a2"]);
});
