import type { ArticleContent, CarouselSlide, Claim, ContentAsset, VideoScript, VisualBrief } from "./schemas";

// One post to repair: its asset, the open claims it carries, and the visual briefs of that asset
// that state one of those claims.
export type RepairUnit = { assetId: string; claimIds: string[]; visualIds: string[] };

export type PostRepair = {
  assetUpdate: {
    copy: string;
    threadPosts: string[];
    article: ArticleContent | null;
    slides: CarouselSlide[];
    videoScript: VideoScript | null;
    linkedClaims: string[];
  };
  visualBriefUpdates: Array<{
    visualBriefId: string;
    purpose: string;
    keyMessage: string;
    dataPoints: string[];
    prompt: string;
    altText: string;
    sourceIds: string[];
  }>;
  claimResolutions: Array<{
    claimId: string;
    action: "removed" | "replaced-with-supported";
    note: string;
    replacementText: string | null;
    sourceId: string | null;
    confidence: number | null;
  }>;
};

export type PostRepairOutcome = { unit: RepairUnit; repair: PostRepair } | { unit: RepairUnit; error: string };

function usedIn(claim: Claim) {
  return new Set(claim.contentUsedIn.split(/[^a-zA-Z0-9-]+/).filter(Boolean));
}

export function buildRepairUnits(targets: Claim[], assets: ContentAsset[], visuals: VisualBrief[]): RepairUnit[] {
  const targetIds = new Set(targets.map((claim) => claim.id));
  return assets.flatMap((asset) => {
    const assetVisualIds = visuals.filter((visual) => visual.assetId === asset.id).map((visual) => visual.id);
    const claimIds = new Set(asset.linkedClaims.filter((claimId) => targetIds.has(claimId)));
    const visualIds = new Set<string>();
    for (const claim of targets) {
      const places = usedIn(claim);
      for (const visualId of assetVisualIds) {
        if (places.has(visualId)) {
          claimIds.add(claim.id);
          visualIds.add(visualId);
        }
      }
    }
    return claimIds.size ? [{ assetId: asset.id, claimIds: Array.from(claimIds), visualIds: Array.from(visualIds) }] : [];
  });
}

type Resolution = PostRepair["claimResolutions"][number];

// Why one post's repair of one claim is not usable, or null when it is.
function resolutionProblem(
  claim: Claim,
  unit: RepairUnit,
  repair: PostRepair,
  validSourceIds: Set<string>
): string | null {
  const resolution = repair.claimResolutions.find((item) => item.claimId === claim.id);
  if (!resolution) return "returned no resolution for " + claim.id;
  const keeps = repair.assetUpdate.linkedClaims.includes(claim.id);
  const visualsForClaim = unit.visualIds.filter((visualId) => usedIn(claim).has(visualId));
  const updated = new Set(repair.visualBriefUpdates.map((update) => update.visualBriefId));
  if (visualsForClaim.some((visualId) => !updated.has(visualId))) return "did not rewrite every visual stating " + claim.id;
  if (resolution.action === "removed") return keeps ? "kept " + claim.id + " after removing it" : null;
  if (!keeps) return "dropped " + claim.id + " after replacing it";
  if (!resolution.replacementText?.trim() || resolution.confidence === null) return "gave no replacement for " + claim.id;
  if (!resolution.sourceId || !validSourceIds.has(resolution.sourceId)) return "cited an unknown source for " + claim.id;
  const visualSourcesOk = repair.visualBriefUpdates
    .filter((update) => visualsForClaim.includes(update.visualBriefId))
    .every((update) => update.sourceIds.includes(resolution.sourceId as string));
  return visualSourcesOk ? null : "did not cite the replacement source in its visuals for " + claim.id;
}

// Combines per-post repairs. A post's rewrite is applied only when it resolves every claim it
// carries; a claim counts as repaired only when every post carrying it agrees on the same action.
export function combinePostRepairs(
  targets: Claim[],
  outcomes: PostRepairOutcome[],
  validSourceIds: Set<string>
): {
  appliedRepairs: Map<string, PostRepair>;
  resolutions: Map<string, Resolution>;
  failures: string[];
} {
  const claimById = new Map(targets.map((claim) => [claim.id, claim]));
  const appliedRepairs = new Map<string, PostRepair>();
  const failures: string[] = [];

  for (const outcome of outcomes) {
    if ("error" in outcome) {
      failures.push(outcome.unit.assetId + ": " + outcome.error);
      continue;
    }
    const problems = outcome.unit.claimIds.flatMap((claimId) => {
      const claim = claimById.get(claimId);
      const problem = claim ? resolutionProblem(claim, outcome.unit, outcome.repair, validSourceIds) : null;
      return problem ? [problem] : [];
    });
    if (problems.length) failures.push(outcome.unit.assetId + ": " + problems.join("; "));
    else appliedRepairs.set(outcome.unit.assetId, outcome.repair);
  }

  const resolutions = new Map<string, Resolution>();
  for (const claim of targets) {
    const carriers = outcomes.filter((outcome) => outcome.unit.claimIds.includes(claim.id));
    if (!carriers.length) continue;
    const chosen = carriers.map((outcome) =>
      appliedRepairs.get(outcome.unit.assetId)?.claimResolutions.find((item) => item.claimId === claim.id)
    );
    if (chosen.some((item) => !item)) continue;
    const actions = new Set(chosen.map((item) => item?.action));
    if (actions.size === 1) resolutions.set(claim.id, chosen[0] as Resolution);
    else failures.push(claim.id + ": posts disagreed on removing or replacing it");
  }
  return { appliedRepairs, resolutions, failures };
}
