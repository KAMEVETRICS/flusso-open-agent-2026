import assert from "node:assert/strict";
import test from "node:test";
import { applyHookReview, normalizeStrategy } from "../lib/strategy.ts";

const segments = [
  { id: "segment-1", name: "Domain flippers" },
  { id: "segment-2", name: "Registrars" }
];

const strategy = {
  statement: "  Onboard domain flippers onchain by showing how tokenized names trade faster than registrar transfers.  ",
  prioritySegmentId: "Domain flippers",
  audienceNeed: "Faster, cheaper domain trades.",
  outOfScope: ["Price predictions", " "],
  successCriteria: [{ outcome: "Flippers onboard", metric: "Wallets that tokenize a name", targetRange: "40-80 in 30 days", baseline: "25 per month", measurement: "Doma app, campaign links" }]
};

test("resolves the priority segment and forces unknown baselines without data", () => {
  const { strategy: normalized, warnings } = normalizeStrategy(strategy, segments, false);
  assert.equal(normalized.prioritySegmentId, "segment-1");
  assert.equal(normalized.statement.startsWith("Onboard"), true);
  assert.deepEqual(normalized.outOfScope, ["Price predictions"]);
  assert.equal(normalized.successCriteria[0].baseline, "unknown");
  assert.deepEqual(warnings, []);

  assert.equal(normalizeStrategy(strategy, segments, true).strategy.successCriteria[0].baseline, "25 per month");
});

test("warns about an unknown segment and a long statement", () => {
  const { strategy: normalized, warnings } = normalizeStrategy(
    { ...strategy, prioritySegmentId: "segment-9", statement: "word ".repeat(31) },
    segments,
    false
  );
  assert.equal(normalized.prioritySegmentId, "");
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /31 words/);
});

function hook(id) {
  return { id, text: "Hook " + id, triggerType: "curiosity", platform: "X", audienceSegment: "segment-1", goal: "onboard" };
}

test("drops off-strategy hooks and renumbers the rest", () => {
  const hooks = ["hook-1", "hook-2", "hook-3", "hook-4", "hook-5", "hook-6", "hook-7"].map(hook);
  const scores = [5, 2, 4, 3, 1, 4, 5];
  const { kept, dropped, idMap } = applyHookReview(
    hooks,
    hooks.map((item, index) => ({ hookId: item.id, strategyFit: scores[index], reason: " Reason " + index + " " }))
  );
  assert.deepEqual(kept.map((item) => [item.id, item.text, item.strategyFit]), [
    ["hook-1", "Hook hook-1", 5],
    ["hook-2", "Hook hook-3", 4],
    ["hook-3", "Hook hook-4", 3],
    ["hook-4", "Hook hook-6", 4],
    ["hook-5", "Hook hook-7", 5]
  ]);
  assert.equal(kept[0].strategyFitReason, "Reason 0");
  assert.deepEqual(dropped.map((item) => item.id), ["hook-2", "hook-5"]);
  assert.equal(idMap.get("hook-7"), "hook-5");
  assert.equal(idMap.has("hook-2"), false);
});

test("keeps the best five even when most hooks score low", () => {
  const hooks = ["a", "b", "c", "d", "e", "f"].map(hook);
  const scores = [2, 1, 4, 2, 1, 2];
  const { kept, dropped } = applyHookReview(
    hooks,
    hooks.map((item, index) => ({ hookId: item.id, strategyFit: scores[index], reason: "" }))
  );
  assert.equal(kept.length, 5);
  assert.deepEqual(dropped.map((item) => item.id), ["e"], "the lowest score goes; ties keep the earlier hook");
});
