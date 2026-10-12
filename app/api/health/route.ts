import process from "node:process";
import { ensureCampaignSchema, isDatabaseConfigured } from "@/lib/db";
import { isFirecrawlConfigured } from "@/lib/firecrawl";

export const dynamic = "force-dynamic";

// Reports configuration readiness without spending model or crawl credits.
export async function GET() {
  const checks = {
    openai: Boolean(process.env.OPENAI_API_KEY?.trim()),
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
