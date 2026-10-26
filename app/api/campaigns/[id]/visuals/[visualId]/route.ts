import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { getCampaign, updateCampaignPack } from "@/lib/campaign-store";
import { generateVisualImage } from "@/lib/image-provider";
import { DeliveryPackSchema, type DeliveryPack } from "@/lib/schemas";
import { getCampaignVisual, saveCampaignVisual } from "@/lib/visual-store";
import { blockingClaims } from "@/lib/visual-rendering";

export const maxDuration = 300;

type RouteContext = { params: Promise<{ id: string; visualId: string }> };

function markVisualGenerated(pack: DeliveryPack, visualId: string) {
  return DeliveryPackSchema.parse({
    ...pack,
    visualBriefs: pack.visualBriefs.map((brief) =>
      brief.id === visualId ? { ...brief, status: "generated" as const, statusNote: "" } : brief
    )
  });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id, visualId } = await context.params;
    const visual = await getCampaignVisual(id, visualId);
    if (!visual) return NextResponse.json({ error: "Visual not found." }, { status: 404 });

    const bytes = Uint8Array.from(Buffer.from(visual.imageBase64, "base64"));
    return new Response(bytes, {
      headers: {
        "Content-Type": visual.mimeType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=31536000, immutable"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load visual.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id, visualId } = await context.params;
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: "Campaign not found." }, { status: 404 });

    const brief = campaign.pack.visualBriefs.find((item) => item.id === visualId);
    if (!brief) return NextResponse.json({ error: "Visual brief not found." }, { status: 404 });

    const blockers = blockingClaims(campaign.pack, brief);
    if (blockers.length) {
      return NextResponse.json(
        { error: "Repair " + blockers.map((claim) => claim.id).join(", ") + " before generating this visual; its post still makes that claim." },
        { status: 409 }
      );
    }

    const existing = await getCampaignVisual(id, visualId);
    if (existing) {
      const pack = markVisualGenerated(campaign.pack, visualId);
      if (brief.status !== "generated") await updateCampaignPack(id, pack);
      return NextResponse.json({ pack, visual: { ...existing, imageBase64: undefined }, reused: true });
    }

    const generated = await generateVisualImage(campaign.pack, brief);
    const visual = await saveCampaignVisual({
      campaignId: id,
      visualBriefId: brief.id,
      assetId: brief.assetId,
      mimeType: generated.mimeType,
      imageBase64: generated.base64,
      model: generated.model
    });
    const pack = markVisualGenerated(campaign.pack, visualId);
    await updateCampaignPack(id, pack);

    return NextResponse.json({
      pack,
      visual: { ...visual, imageBase64: undefined },
      reused: false
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate visual.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}