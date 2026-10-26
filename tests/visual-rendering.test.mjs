import assert from "node:assert/strict";
import test from "node:test";
import { blockingClaims } from "../lib/visual-rendering.ts";

function claim(id, status, extra = {}) {
  return { id, status, resolutionStatus: "unresolved", contentUsedIn: "", ...extra };
}

const pack = {
  assets: [
    { id: "asset-1", linkedClaims: ["claim-1", "claim-2"] },
    { id: "asset-2", linkedClaims: ["claim-3"] }
  ],
  proofReport: {
    claims: [
      claim("claim-1", "supported"),
      claim("claim-2", "unsupported"),
      claim("claim-3", "unsupported", { resolutionStatus: "repaired" }),
      claim("claim-4", "conflict", { contentUsedIn: "visual-3" })
    ]
  }
};

test("holds a visual only while its own post or brief carries an open claim", () => {
  assert.deepEqual(blockingClaims(pack, { id: "visual-1", assetId: "asset-1" }).map((item) => item.id), ["claim-2"]);
  assert.deepEqual(blockingClaims(pack, { id: "visual-2", assetId: "asset-2" }), [], "repaired claims do not block");
  assert.deepEqual(blockingClaims(pack, { id: "visual-3", assetId: "asset-9" }).map((item) => item.id), ["claim-4"]);
});
