import assert from "node:assert/strict";
import test from "node:test";
import { inspectEditorialAssets, matchAssetsToDrafts } from "../lib/editorial-policy.ts";

const brief = {
  platforms: ["Medium"]
};

function articleAsset(wordsPerSection) {
  const body = Array.from({ length: wordsPerSection }, (_, index) => `word${index}`).join(" ");
  return {
    id: "asset-1",
    type: "article",
    platform: "Medium",
    title: "A specific technical article",
    copy: "A concise summary.",
    cta: "Review the implementation.",
    linkedClaims: [],
    calendarItemId: "cal-1",
    seriesId: "series-1",
    segment: "builders",
    territory: "infrastructure",
    hookId: "hook-1",
    editorialMode: "technical-explainer",
    contentFormat: "article",
    threadPosts: [],
    article: {
      subtitle: "A practical architecture review",
      introduction: body,
      sections: [
        { heading: "Mechanism", body },
        { heading: "Tradeoffs", body },
        { heading: "Operations", body }
      ],
      conclusion: body,
      tags: ["architecture"]
    },
    visualBriefId: ""
  };
}

test("rejects structurally complete but shallow articles", () => {
  const issues = inspectEditorialAssets([articleAsset(20)], brief);
  assert.ok(issues.some((issue) => issue.code === "article-depth"));
});

test("accepts developed articles of at least 300 words", () => {
  const issues = inspectEditorialAssets([articleAsset(70)], brief);
  assert.equal(issues.some((issue) => issue.code === "article-depth"), false);
});

const drafts = [1, 2, 3, 4, 5].map((n) => ({ id: "asset-" + n, calendarItemId: "cal-" + n }));

test("keeps rewritten assets that return their exact draft IDs", () => {
  const result = matchAssetsToDrafts(drafts.map((draft) => ({ ...draft, title: "rewrite" })), drafts);
  assert.deepEqual(result.matched.map((asset) => asset.id), ["asset-1", "asset-2", "asset-3", "asset-4", "asset-5"]);
  assert.equal(result.renamed.size, 0);
  assert.deepEqual(result.missing, []);
});

test("restores renamed assets by calendar item and reports omitted drafts", () => {
  const result = matchAssetsToDrafts([
    { id: "asset-1", calendarItemId: "cal-1" },
    { id: "asset_02", calendarItemId: "cal-2" },
    { id: "asset-4", calendarItemId: "cal-4" },
    { id: "bonus", calendarItemId: "cal-9" },
    { id: "asset-4", calendarItemId: "cal-4" }
  ], drafts);

  assert.deepEqual(result.matched.map((asset) => asset.id).sort(), ["asset-1", "asset-2", "asset-4"]);
  assert.deepEqual([...result.renamed], [["asset_02", "asset-2"]]);
  assert.deepEqual(result.missing.map((draft) => draft.id), ["asset-3", "asset-5"]);
});

test("prefers exact IDs over calendar matches from other candidates", () => {
  const result = matchAssetsToDrafts([
    { id: "renamed", calendarItemId: "cal-1", title: "wrong" },
    { id: "asset-1", calendarItemId: "cal-1", title: "right" }
  ], drafts.slice(0, 1));
  assert.deepEqual(result.matched, [{ id: "asset-1", calendarItemId: "cal-1", title: "right" }]);
  assert.equal(result.renamed.size, 0);
});
