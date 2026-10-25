import { randomUUID } from "node:crypto";
import {
  PerformanceRecordSchema,
  type ContentAsset,
  type PerformanceContext,
  type PerformanceInput,
  type PerformanceRecord
} from "./schemas";
import { ensureCampaignSchema, getDatabase } from "./db";
import { summarizePerformance } from "./performance";

type PerformanceRow = {
  id: string;
  campaign_id: string;
  asset_id: string;
  asset_title: string;
  asset_type: string;
  platform: PerformanceRecord["platform"];
  hook_id: string;
  territory: string;
  impressions: number | string;
  views: number | string;
  engagements: number | string;
  clicks: number | string;
  conversions: number | string;
  watch_time_seconds: number | string;
  notes: string;
  updated_at: string | Date;
};

function metric(value: number | string) {
  return Number(value);
}

function toRecord(row: PerformanceRow): PerformanceRecord {
  return PerformanceRecordSchema.parse({
    id: row.id,
    campaignId: row.campaign_id,
    assetId: row.asset_id,
    assetTitle: row.asset_title,
    assetType: row.asset_type,
    platform: row.platform,
    hookId: row.hook_id,
    territory: row.territory,
    impressions: metric(row.impressions),
    views: metric(row.views),
    engagements: metric(row.engagements),
    clicks: metric(row.clicks),
    conversions: metric(row.conversions),
    watchTimeSeconds: metric(row.watch_time_seconds),
    notes: row.notes,
    updatedAt: new Date(row.updated_at).toISOString()
  });
}

export async function getCampaignPerformance(campaignId: string): Promise<PerformanceRecord[]> {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const rows = await sql`
    SELECT
      id,
      campaign_id,
      asset_id,
      asset_title,
      asset_type,
      platform,
      hook_id,
      territory,
      impressions,
      views,
      engagements,
      clicks,
      conversions,
      watch_time_seconds,
      notes,
      updated_at
    FROM content_performance
    WHERE campaign_id = ${campaignId}
    ORDER BY updated_at DESC, asset_id ASC
  ` as PerformanceRow[];
  return rows.map(toRecord);
}

export async function savePerformanceRecord(
  campaignId: string,
  asset: ContentAsset,
  input: PerformanceInput
): Promise<PerformanceRecord> {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const id = randomUUID();
  const rows = await sql`
    INSERT INTO content_performance (
      id,
      campaign_id,
      asset_id,
      asset_title,
      asset_type,
      platform,
      hook_id,
      territory,
      impressions,
      views,
      engagements,
      clicks,
      conversions,
      watch_time_seconds,
      notes
    ) VALUES (
      ${id},
      ${campaignId},
      ${asset.id},
      ${asset.title},
      ${asset.type},
      ${asset.platform},
      ${asset.hookId},
      ${asset.territory},
      ${input.impressions},
      ${input.views},
      ${input.engagements},
      ${input.clicks},
      ${input.conversions},
      ${input.watchTimeSeconds},
      ${input.notes}
    )
    ON CONFLICT (campaign_id, asset_id) DO UPDATE SET
      asset_title = EXCLUDED.asset_title,
      asset_type = EXCLUDED.asset_type,
      platform = EXCLUDED.platform,
      hook_id = EXCLUDED.hook_id,
      territory = EXCLUDED.territory,
      impressions = EXCLUDED.impressions,
      views = EXCLUDED.views,
      engagements = EXCLUDED.engagements,
      clicks = EXCLUDED.clicks,
      conversions = EXCLUDED.conversions,
      watch_time_seconds = EXCLUDED.watch_time_seconds,
      notes = EXCLUDED.notes,
      updated_at = now()
    RETURNING
      id,
      campaign_id,
      asset_id,
      asset_title,
      asset_type,
      platform,
      hook_id,
      territory,
      impressions,
      views,
      engagements,
      clicks,
      conversions,
      watch_time_seconds,
      notes,
      updated_at
  ` as PerformanceRow[];

  if (!rows[0]) throw new Error("Performance save returned no database row.");
  return toRecord(rows[0]);
}

export async function getPerformanceContextForBrand(brand: string, goal: string): Promise<PerformanceContext> {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const rows = await sql`
    SELECT
      p.id,
      p.campaign_id,
      p.asset_id,
      p.asset_title,
      p.asset_type,
      p.platform,
      p.hook_id,
      p.territory,
      p.impressions,
      p.views,
      p.engagements,
      p.clicks,
      p.conversions,
      p.watch_time_seconds,
      p.notes,
      p.updated_at
    FROM content_performance AS p
    INNER JOIN campaign_runs AS run ON run.id = p.campaign_id
    WHERE lower(btrim(run.brand)) = lower(btrim(${brand}))
    ORDER BY p.updated_at DESC
  ` as PerformanceRow[];

  return summarizePerformance(rows.map(toRecord), brand, goal);
}