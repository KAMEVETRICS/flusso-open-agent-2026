import { randomUUID } from "node:crypto";
import { z } from "zod";
import { findSampleFixture, isSampleMode, runEvidenceAgent } from "@/lib/agent/run-agent";
import { zetarisConfigFromEnv } from "@/lib/agent/zetaris";
import { normalizeBrief } from "@/lib/brief";
import { brandDomain, emptyBrandModel, getBrandModel, learnFromCampaign, saveBrandModel } from "@/lib/brand-model";
import { saveCampaign, updateCampaignPack } from "@/lib/campaign-store";
import { ensureCampaignSchema } from "@/lib/db";
import { discoverBrief, type DiscoveryResult } from "@/lib/discovery";
import { isFirecrawlConfigured } from "@/lib/firecrawl";
import { createContentGenerationProvider } from "@/lib/provider";
import { getPerformanceContextForBrand } from "@/lib/performance-store";
import { routePromptLibrary } from "@/lib/prompt-library";
import { renderCampaignVisuals } from "@/lib/visual-rendering";

export const maxDuration = 300;

function encodeEvent(event: string, data: unknown) {
  return new TextEncoder().encode("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
}

// The evidence agent is advisory: the campaign still runs its own evidence checks, so when Zetaris
// is not set up or the agent fails, the stream says so and generation continues without a plan.
async function runAgentStep(discovery: DiscoveryResult, domain: string, send: (event: string, data: unknown) => void) {
  const sample = isSampleMode() ? findSampleFixture(domain) : null;
  if (isSampleMode() && !sample) {
    send("agent", { status: "skipped", message: "SAMPLE_MODE has no recorded agent run for " + domain + "." });
    return null;
  }
  if (!sample && !zetarisConfigFromEnv()) {
    send("agent", { status: "skipped", message: "Zetaris is not configured (ZETARIS_REST_URL, ZETARIS_API_KEY)." });
    return null;
  }
  send("agent", { status: "running" });
  try {
    const run = await runEvidenceAgent(
      { brief: discovery.brief, domain, factSheet: discovery.factSheet, sources: discovery.sources },
      { runId: (sample ? "sample-" : "live-") + randomUUID(), sample }
    );
    send("agent", { status: "done", plan: run.plan });
    return run;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Flusso evidence agent failed: " + message);
    send("agent", { status: "failed", message: "Evidence agent failed: " + message });
    return null;
  }
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

        send("ready", { stages: ["discovery", "agent", "foundation", "architecture", "execution", "editorial", "governance", "verification", "visuals"] });

        void (async () => {
          try {
            await ensureCampaignSchema();
            const domain = brandDomain(input.website);
            const memory = await getBrandModel(domain);
            const discovery = await discoverBrief(input, provider, memory);
            send("discovery", {
              brief: discovery.brief,
              inferredFields: discovery.inferredFields,
              sourceCount: discovery.sources.filter((source) => source.fetchStatus === "fetched").length,
              factCount: discovery.factSheet.facts.length,
              factGaps: discovery.factSheet.gaps
            });
            const agent = await runAgentStep(discovery, domain, send);
            const promptRouting = routePromptLibrary(discovery.brief);
            const performanceContext = await getPerformanceContextForBrand(discovery.brief.brand, discovery.brief.goal);
            const pack = await provider.generateCampaignPack(
              discovery.brief,
              promptRouting,
              performanceContext,
              { ...discovery, agentPlan: agent?.plan ?? null },
              (stage) => send("stage", stage)
            );
            const campaign = await saveCampaign(pack);
            // Images are stored against the saved campaign, so they render after the save.
            send("visuals", { total: pack.visualBriefs.length });
            const rendered = await renderCampaignVisuals(campaign.id, pack, (outcome) => send("visual", outcome));
            await updateCampaignPack(campaign.id, rendered.pack);
            // The brand model makes the next campaign for this domain faster and consistent; a
            // failure to save it never loses the campaign itself.
            try {
              await saveBrandModel(learnFromCampaign(memory ?? emptyBrandModel(domain), rendered.pack, new Date().toISOString()));
            } catch (error) {
              console.error("Flusso brand model save failed: " + (error instanceof Error ? error.message : String(error)));
            }
            // H-MEM learns which claims failed and which decisions held, for the next campaign.
            try {
              agent?.remember(campaign.id, rendered.pack);
            } catch (error) {
              console.error("Flusso H-MEM update failed: " + (error instanceof Error ? error.message : String(error)));
            }
            send("complete", { pack: rendered.pack, campaignId: campaign.id });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to generate campaign pack.";
            console.error("Flusso campaign generation failed: " + message);
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
