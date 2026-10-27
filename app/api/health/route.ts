import { zetarisConfigFromEnv } from "@/lib/agent/zetaris";
import { ensureCampaignSchema, isDatabaseConfigured } from "@/lib/db";
import { isFirecrawlConfigured } from "@/lib/firecrawl";
import { isMeterlessConfigured, isTextProviderConfigured, probeMeterless } from "@/lib/model-provider";
import { isOpenRouterConfigured } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

// Reports configuration readiness without spending model or crawl credits.
export async function GET() {
  const checks = {
    textProvider: isTextProviderConfigured(),
    firecrawl: isFirecrawlConfigured(),
    database: isDatabaseConfigured()
  };
  // Meterless Nightshift is the primary provider; /v1/models tells online from unauthorized.
  const providers = {
    meterless: isMeterlessConfigured() ? (await probeMeterless()).state : "not configured",
    openrouter: isOpenRouterConfigured() ? "configured" : "not configured",
    zetaris: zetarisConfigFromEnv() ? "configured" : "not configured"
  };

  if (checks.database) {
    try {
      await ensureCampaignSchema();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database check failed.";
      return Response.json({ status: "error", checks, providers, error: message }, { status: 503 });
    }
  }

  const ready = Object.values(checks).every(Boolean);
  return Response.json({ status: ready ? "ready" : "incomplete", checks, providers }, { status: ready ? 200 : 503 });
}
