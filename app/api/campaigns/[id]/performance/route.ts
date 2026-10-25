import { NextResponse } from "next/server";
import { z } from "zod";
import { getCampaign } from "@/lib/campaign-store";
import {
  getCampaignPerformance,
  getPerformanceContextForBrand,
  savePerformanceRecord
} from "@/lib/performance-store";
import { PerformanceInputSchema } from "@/lib/schemas";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const [records, summary] = await Promise.all([
      getCampaignPerformance(id),
      getPerformanceContextForBrand(campaign.pack.brief.brand, campaign.pack.brief.goal)
    ]);
    return NextResponse.json({ records, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load performance.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const input = PerformanceInputSchema.parse(await request.json());
    const asset = campaign.pack.assets.find((item) => item.id === input.assetId);
    if (!asset) {
      return NextResponse.json({ error: "Asset does not belong to this campaign." }, { status: 400 });
    }

    const record = await savePerformanceRecord(id, asset, input);
    const [records, summary] = await Promise.all([
      getCampaignPerformance(id),
      getPerformanceContextForBrand(campaign.pack.brief.brand, campaign.pack.brief.goal)
    ]);
    return NextResponse.json({ record, records, summary });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Invalid performance metrics." },
        { status: 400 }
      );
    }
    const message = error instanceof Error ? error.message : "Unable to save performance.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}