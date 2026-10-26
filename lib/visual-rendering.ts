import { DeliveryPackSchema, type DeliveryPack, type VisualBrief } from "./schemas";
import { generateVisualImage } from "./image-provider";
import { getCampaignVisual, saveCampaignVisual } from "./visual-store";

const RENDER_CONCURRENCY = 3;

export type VisualRenderOutcome = { visualId: string; status: VisualBrief["status"]; note: string };

// A visual for an asset that still carries an unsupported or conflicting claim would illustrate
// that claim, so it waits until the claim is repaired.
export function blockingClaims(pack: DeliveryPack, brief: VisualBrief) {
  const asset = pack.assets.find((item) => item.id === brief.assetId);
  const linked = new Set(asset?.linkedClaims ?? []);
  return pack.proofReport.claims.filter(
    (claim) =>
      claim.resolutionStatus === "unresolved" &&
      (claim.status === "unsupported" || claim.status === "conflict") &&
      (linked.has(claim.id) || claim.contentUsedIn.split(/[^a-zA-Z0-9-]+/).includes(brief.id))
  );
}

// Renders every planned visual of a saved campaign and records each outcome on its brief.
// One failed image never stops the others.
export async function renderCampaignVisuals(
  campaignId: string,
  pack: DeliveryPack,
  onRendered?: (outcome: VisualRenderOutcome) => void
): Promise<{ pack: DeliveryPack; outcomes: VisualRenderOutcome[] }> {
  const pending = pack.visualBriefs.filter((brief) => brief.status !== "generated");
  const outcomes: VisualRenderOutcome[] = [];
  let next = 0;

  async function render(brief: VisualBrief): Promise<VisualRenderOutcome> {
    const blockers = blockingClaims(pack, brief);
    if (blockers.length) {
      return { visualId: brief.id, status: "planned", note: "Waiting on " + blockers.map((claim) => claim.id).join(", ") + ", which still needs a source." };
    }
    try {
      if (!(await getCampaignVisual(campaignId, brief.id))) {
        const image = await generateVisualImage(pack, brief);
        await saveCampaignVisual({
          campaignId,
          visualBriefId: brief.id,
          assetId: brief.assetId,
          mimeType: image.mimeType,
          imageBase64: image.base64,
          model: image.model
        });
      }
      return { visualId: brief.id, status: "generated", note: "" };
    } catch (error) {
      return { visualId: brief.id, status: "failed", note: error instanceof Error ? error.message : String(error) };
    }
  }

  async function worker() {
    while (next < pending.length) {
      const brief = pending[next];
      next += 1;
      const outcome = await render(brief);
      outcomes.push(outcome);
      onRendered?.(outcome);
    }
  }
  await Promise.all(Array.from({ length: Math.min(RENDER_CONCURRENCY, pending.length) }, worker));

  const byId = new Map(outcomes.map((outcome) => [outcome.visualId, outcome]));
  return {
    pack: DeliveryPackSchema.parse({
      ...pack,
      visualBriefs: pack.visualBriefs.map((brief) => {
        const outcome = byId.get(brief.id);
        return outcome ? { ...brief, status: outcome.status, statusNote: outcome.note } : brief;
      })
    }),
    outcomes
  };
}
