import { NextResponse } from "next/server";
import { getCampaign, searchCampaignSections } from "@/lib/campaign-store";

const MIN_QUERY_CHARS = 2;
const MAX_QUERY_CHARS = 200;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length < MIN_QUERY_CHARS || query.length > MAX_QUERY_CHARS) {
      return NextResponse.json(
        { error: "Search for " + MIN_QUERY_CHARS + " to " + MAX_QUERY_CHARS + " characters." },
        { status: 400 }
      );
    }
    const campaign = await getCampaign(id);
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }

    const results = await searchCampaignSections(id, campaign.pack, query);
    return NextResponse.json({ query, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to search sources.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
