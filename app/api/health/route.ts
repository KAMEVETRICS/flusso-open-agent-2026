import { ensureCampaignSchema, isDatabaseConfigured } from "@/lib/db";
import { isFirecrawlConfigured } from "@/lib/firecrawl";
import { isOpenRouterConfigured } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

// Reports configuration readiness without spending model or crawl credits.
export async function GET() {
  const checks = {
    openrouter: isOpenRouterConfigured(),
    firecrawl: isFirecrawlConfigured(),
    database: isDatabaseConfigured()
  };

  if (checks.database) {
    try {
      await ensureCampaignSchema();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Database check failed.";
      return Response.json({ status: "error", checks, error: message }, { status: 503 });
    }
  }

  const ready = Object.values(checks).every(Boolean);
  return Response.json({ status: ready ? "ready" : "incomplete", checks }, { status: ready ? 200 : 503 });
}
