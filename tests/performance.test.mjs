import assert from "node:assert/strict";
import test from "node:test";
import { performanceObjective, summarizePerformance } from "../lib/performance.ts";

function record(id, platform, metrics) {
  return {
    id,
    campaignId: "campaign-1",
    assetId: "asset-" + id,
    assetTitle: "Asset " + id,
    assetType: "short-post",
    platform,
    hookId: "hook-" + id,
    territory: "territory-1",
    impressions: 0,
    views: 0,
    engagements: 0,
    clicks: 0,
    conversions: 0,
    watchTimeSeconds: 0,
    notes: "",
    updatedAt: "2026-10-25T00:00:00.000Z",
    ...metrics
  };
}

// X engages more; LinkedIn converts more per impression.
const records = [
  record("1", "X", { impressions: 10000, engagements: 900, clicks: 200, conversions: 4 }),
  record("2", "LinkedIn", { impressions: 2000, engagements: 60, clicks: 80, conversions: 12 })
];

test("reads the ranking objective from the campaign goal", () => {
  assert.equal(performanceObjective("onboard domain degens/flippers onchain"), "conversion");
  assert.equal(performanceObjective("Grow sign-ups for the beta"), "conversion");
  assert.equal(performanceObjective("Drive traffic to the docs"), "traffic");
  assert.equal(performanceObjective("Build awareness among builders"), "engagement");
});

test("ranks patterns and assets by the goal's outcome", () => {
  const conversion = summarizePerformance(records, "Doma", "onboard domain flippers");
  assert.equal(conversion.objective, "conversion");
  assert.equal(conversion.platformPatterns[0].key, "LinkedIn");
  assert.equal(conversion.topAssets[0].platform, "LinkedIn");
  assert.match(conversion.learnings[0], /LinkedIn has the most conversions per impression at 0\.60% \(12 conversions\) across 1 recorded asset\(s\) and 2000 impressions/);

  const engagement = summarizePerformance(records, "Doma", "Build awareness");
  assert.equal(engagement.objective, "engagement");
  assert.equal(engagement.platformPatterns[0].key, "X");
  assert.match(engagement.learnings[0], /highest engagement rate at 9\.00%/);
});

test("keeps the objective when there are no records", () => {
  const empty = summarizePerformance([], "Doma", "onboard flippers");
  assert.equal(empty.objective, "conversion");
  assert.equal(empty.recordCount, 0);
});
