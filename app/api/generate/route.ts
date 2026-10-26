import { z } from "zod";
import { normalizeBrief } from "@/lib/brief";
import { saveCampaign, updateCampaignPack } from "@/lib/campaign-store";
import { ensureCampaignSchema } from "@/lib/db";
import { discoverBrief } from "@/lib/discovery";
import { isFirecrawlConfigured } from "@/lib/firecrawl";
import { createContentGenerationProvider } from "@/lib/provider";
import { getPerformanceContextForBrand } from "@/lib/performance-store";
import { routePromptLibrary } from "@/lib/prompt-library";
import { renderCampaignVisuals } from "@/lib/visual-rendering";

export const maxDuration = 300;

function encodeEvent(event: string, data: unknown) {
  return new TextEncoder().encode("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
}

function inputErrorMessage(error: z.ZodError) {
  const field = String(error.issues[0]?.path[0] ?? "");
  if (field === "website") return "Enter a valid website URL.";
  if (field === "goal") return "Describe the campaign goal in at least five characters.";
  return error.issues[0]?.message ?? "Invalid campaign brief.";
}

export async function POST(request: Request) {
  try {
    const input = normalizeBrief(await request.json());
    if (!isFirecrawlConfigured()) {
      throw new Error("FIRECRAWL_API_KEY is missing. Add it to .env.local and restart the server.");
    }
    const provider = createContentGenerationProvider();
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (event: string, data: unknown) => {
          if (cancelled) return;
          try {
            controller.enqueue(encodeEvent(event, data));
          } catch {
            cancelled = true;
          }
        };

        send("ready", { stages: ["discovery", "foundation", "architecture", "execution", "editorial", "governance", "verification", "visuals"] });

        void (async () => {
          try {
            await ensureCampaignSchema();
            const discovery = await discoverBrief(input, provider);
            send("discovery", {
              brief: discovery.brief,
              inferredFields: discovery.inferredFields,
              sourceCount: discovery.sources.filter((source) => source.fetchStatus === "fetched").length,
              factCount: discovery.factSheet.facts.length,
              factGaps: discovery.factSheet.gaps
            });
            const promptRouting = routePromptLibrary(discovery.brief);
            const performanceContext = await getPerformanceContextForBrand(discovery.brief.brand, discovery.brief.goal);
            const pack = await provider.generateCampaignPack(
              discovery.brief,
              promptRouting,
              performanceContext,
              discovery,
              (stage) => send("stage", stage)
            );
            const campaign = await saveCampaign(pack);
            // Images are stored against the saved campaign, so they render after the save.
            send("visuals", { total: pack.visualBriefs.length });
            const rendered = await renderCampaignVisuals(campaign.id, pack, (outcome) => send("visual", outcome));
            await updateCampaignPack(campaign.id, rendered.pack);
            send("complete", { pack: rendered.pack, campaignId: campaign.id });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to generate campaign pack.";
            send("error", { message });
          } finally {
            if (!cancelled) controller.close();
          }
        })();
      },
      cancel() {
        cancelled = true;
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: inputErrorMessage(error) }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Unable to generate campaign pack.";
    return Response.json({ error: message }, { status: 500 });
  }
}
