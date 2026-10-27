import assert from "node:assert/strict";
import test from "node:test";
import { buildRepairUnits, combinePostRepairs } from "../lib/claim-repair.ts";

function claim(id, contentUsedIn = "") {
  return { id, status: "unsupported", resolutionStatus: "unresolved", contentUsedIn };
}

const targets = [claim("claim-1"), claim("claim-2", "visual-2")];
const assets = [
  { id: "asset-1", linkedClaims: ["claim-1", "claim-9"] },
  { id: "asset-2", linkedClaims: ["claim-1"] },
  { id: "asset-3", linkedClaims: [] },
  { id: "asset-4", linkedClaims: ["claim-9"] }
];
const visuals = [
  { id: "visual-2", assetId: "asset-3" },
  { id: "visual-4", assetId: "asset-4" }
];

function repair(linkedClaims, resolutions, visualIds = []) {
  return {
    assetUpdate: { copy: "Rewritten", threadPosts: [], article: null, slides: [], videoScript: null, linkedClaims },
    visualBriefUpdates: visualIds.map((visualBriefId) => ({ visualBriefId, purpose: "", keyMessage: "", dataPoints: [], prompt: "", altText: "", sourceIds: ["src-docs"] })),
    claimResolutions: resolutions
  };
}

const removed = (claimId) => ({ claimId, action: "removed", note: "Removed.", replacementText: null, sourceId: null, confidence: null });
const replaced = (claimId, sourceId = "src-docs") => ({ claimId, action: "replaced-with-supported", note: "Replaced.", replacementText: "Backed text", sourceId, confidence: 90 });

test("makes one repair unit per post, including posts whose visual states the claim", () => {
  assert.deepEqual(buildRepairUnits(targets, assets, visuals), [
    { assetId: "asset-1", claimIds: ["claim-1"], visualIds: [] },
    { assetId: "asset-2", claimIds: ["claim-1"], visualIds: [] },
    { assetId: "asset-3", claimIds: ["claim-2"], visualIds: ["visual-2"] }
  ]);
});

test("repairs a claim only when every post carrying it agrees", () => {
  const units = buildRepairUnits(targets, assets, visuals);
  const { appliedRepairs, resolutions, failures } = combinePostRepairs(targets, [
    { unit: units[0], repair: repair(["claim-9"], [removed("claim-1")]) },
    { unit: units[1], repair: repair([], [removed("claim-1")]) },
    { unit: units[2], repair: repair(["claim-2"], [replaced("claim-2")], ["visual-2"]) }
  ], new Set(["src-docs"]));
  assert.deepEqual([...appliedRepairs.keys()], ["asset-1", "asset-2", "asset-3"]);
  assert.deepEqual([...resolutions.keys()], ["claim-1", "claim-2"]);
  assert.deepEqual(failures, []);
});

test("keeps the other posts when one post fails, but leaves its claim open", () => {
  const units = buildRepairUnits(targets, assets, visuals);
  const { appliedRepairs, resolutions, failures } = combinePostRepairs(targets, [
    { unit: units[0], repair: repair(["claim-9"], [removed("claim-1")]) },
    { unit: units[1], error: "output was cut off" },
    { unit: units[2], repair: repair(["claim-2"], [replaced("claim-2")], ["visual-2"]) }
  ], new Set(["src-docs"]));
  assert.deepEqual([...appliedRepairs.keys()], ["asset-1", "asset-3"]);
  assert.deepEqual([...resolutions.keys()], ["claim-2"], "claim-1 still appears in asset-2");
  assert.deepEqual(failures, ["asset-2: output was cut off"]);
});

test("rejects inconsistent or unsupported post repairs", () => {
  const units = buildRepairUnits(targets, assets, visuals);
  const { appliedRepairs, failures } = combinePostRepairs(targets, [
    { unit: units[0], repair: repair(["claim-1", "claim-9"], [removed("claim-1")]) },
    { unit: units[1], repair: repair(["claim-1"], [replaced("claim-1", "src-invented")]) },
    { unit: units[2], repair: repair(["claim-2"], [replaced("claim-2")]) }
  ], new Set(["src-docs"]));
  assert.equal(appliedRepairs.size, 0);
  assert.deepEqual(failures, [
    "asset-1: kept claim-1 after removing it",
    "asset-2: cited an unknown source for claim-1",
    "asset-3: did not rewrite every visual stating claim-2"
  ]);
});

test("flags posts that disagree on removing or replacing a claim", () => {
  const units = buildRepairUnits(targets, assets, visuals);
  const { resolutions, failures } = combinePostRepairs([targets[0]], [
    { unit: units[0], repair: repair(["claim-9"], [removed("claim-1")]) },
    { unit: units[1], repair: repair(["claim-1"], [replaced("claim-1")]) }
  ], new Set(["src-docs"]));
  assert.equal(resolutions.size, 0);
  assert.deepEqual(failures, ["claim-1: posts disagreed on removing or replacing it"]);
});
