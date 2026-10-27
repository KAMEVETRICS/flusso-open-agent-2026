import { NextResponse } from "next/server";
import {
  getCampaign,
  getCampaignStageArtifacts,
  updateCampaignPack
} from "@/lib/campaign-store";
import { createContentGenerationProvider } from "@/lib/provider";

export const maxDuration = 300;

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const targetClaimIds = new Set(
      campaign.pack.proofReport.claims
        .filter(
          (claim) =>
            claim.resolutionStatus === "unresolved" &&
            (claim.status === "unsupported" || claim.status === "conflict")
        )
        .map((claim) => claim.id)
    );
    if (!targetClaimIds.size) {
      return NextResponse.json({
        pack: campaign.pack,
        stageArtifacts: campaign.stageArtifacts,
        repairedClaims: 0
      });
    }

    const provider = createContentGenerationProvider();
    const pack = await provider.repairUnsupportedClaims(campaign.pack);
    await updateCampaignPack(id, pack);
    const stageArtifacts = await getCampaignStageArtifacts(id);
    const repairedClaims = pack.proofReport.claims.filter(
      (claim) => targetClaimIds.has(claim.id) && claim.resolutionStatus === "repaired"
    ).length;

    return NextResponse.json({ pack, stageArtifacts, repairedClaims });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to repair unsupported claims.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}