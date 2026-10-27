import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { z } from "zod";
import { loadSampleFixture, runEvidenceAgent } from "@/lib/agent/run-agent";
import type { TraceSink } from "@/lib/agent/trace";
import { brandDomain } from "@/lib/brand-model";

export const maxDuration = 300;

// Runs the evidence agent for one of the sample brands and streams every trace record as a
// server-sent event, so the Evidence Console can show the reasoning as it happens. "live" queries
// Zetaris and calls Nightshift; "replay" uses the recorded run and needs neither.
const RequestSchema = z.object({
  sample: z.enum(["allbirds-newsletter", "linear-asks", "wise-freelancers"]),
  mode: z.enum(["live", "replay"])
});

function encodeEvent(event: string, data: unknown) {
  return new TextEncoder().encode("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
}

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pick a sample and a mode." }, { status: 400 });
  const { sample, mode } = parsed.data;
  const directory = path.join(process.cwd(), "samples", sample);
  const discoveryFile = path.join(directory, "discovery.json");
  if (!existsSync(discoveryFile)) return Response.json({ error: "Sample " + sample + " is missing." }, { status: 404 });
  const input = JSON.parse(readFileSync(path.join(directory, "input.json"), "utf8")) as { website: string; goal: string; audience?: string };
  const discovery = JSON.parse(readFileSync(discoveryFile, "utf8"));
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
      const streamSink: TraceSink = (traceStream, record) => send("record", { stream: traceStream, ...record });
      send("start", { sample, mode, input, factCount: discovery.factSheet.facts.length, fromCampaign: discovery.fromCampaign ?? null });

      void (async () => {
        const started = Date.now();
        try {
          const run = await runEvidenceAgent(
            { brief: discovery.brief, domain: brandDomain(input.website), factSheet: discovery.factSheet, sources: discovery.sources },
            {
              runId: (mode === "live" ? "console-live-" : "console-replay-") + sample + "-" + randomUUID().slice(0, 8),
              sample: mode === "replay" ? loadSampleFixture(directory) : null,
              extraSinks: [streamSink]
            }
          );
          send("plan", { plan: run.plan, seconds: (Date.now() - started) / 1000 });
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : String(error) });
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
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    }
  });
}
