import process from "node:process";
import { neon, neonConfig } from "@neondatabase/serverless";

const NETWORK_RETRIES = 2;
const RETRY_DELAY_MS = 750;

let database: ReturnType<typeof neon> | null = null;
let schemaPromise: Promise<void> | null = null;

// Neon serves queries over HTTPS. Retry connection-level failures, such as a compute waking from
// scale-to-zero; Flusso writes are upserts, so a retried request does not duplicate rows.
async function fetchWithRetry(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (attempt >= NETWORK_RETRIES || !(error instanceof TypeError)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * (attempt + 1)));
    }
  }
}

neonConfig.fetchFunction = fetchWithRetry;

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is missing. Add the Neon pooled connection string to .env.local before generating.");
  }

  database ??= neon(connectionString);
  return database;
}

export function ensureCampaignSchema() {
  schemaPromise ??= (async () => {
    const sql = getDatabase();
    await sql`
      CREATE TABLE IF NOT EXISTS campaign_runs (
        id text PRIMARY KEY,
        brand text NOT NULL,
        goal text NOT NULL,
        provider text NOT NULL,
        model text NOT NULL,
        brief jsonb NOT NULL,
        delivery_pack jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS campaign_runs_created_at_idx
      ON campaign_runs (created_at DESC)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS campaign_stage_artifacts (
        campaign_id text NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
        stage text NOT NULL CHECK (stage IN ('foundation', 'architecture', 'execution', 'editorial', 'governance', 'verification')),
        position smallint NOT NULL CHECK (position BETWEEN 1 AND 6),
        label text NOT NULL,
        status text NOT NULL,
        started_at timestamptz NOT NULL,
        completed_at timestamptz NOT NULL,
        duration_ms integer NOT NULL CHECK (duration_ms >= 0),
        output_keys jsonb NOT NULL,
        artifact jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (campaign_id, stage)
      )
    `;
    await sql`
      ALTER TABLE campaign_stage_artifacts
      DROP CONSTRAINT IF EXISTS campaign_stage_artifacts_stage_check
    `;
    await sql`
      ALTER TABLE campaign_stage_artifacts
      ADD CONSTRAINT campaign_stage_artifacts_stage_check
      CHECK (stage IN ('foundation', 'architecture', 'execution', 'editorial', 'governance', 'verification'))
    `;
    await sql`
      ALTER TABLE campaign_stage_artifacts
      DROP CONSTRAINT IF EXISTS campaign_stage_artifacts_position_check
    `;
    await sql`
      ALTER TABLE campaign_stage_artifacts
      ADD CONSTRAINT campaign_stage_artifacts_position_check
      CHECK (position BETWEEN 1 AND 6)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS campaign_stage_artifacts_order_idx
      ON campaign_stage_artifacts (campaign_id, position)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS content_performance (
        id text PRIMARY KEY,
        campaign_id text NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
        asset_id text NOT NULL,
        asset_title text NOT NULL,
        asset_type text NOT NULL,
        platform text NOT NULL CHECK (platform IN ('X', 'LinkedIn', 'Newsletter', 'Discord', 'Mirror', 'Medium', 'Instagram', 'TikTok')),
        hook_id text NOT NULL DEFAULT '',
        territory text NOT NULL DEFAULT '',
        impressions bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
        views bigint NOT NULL DEFAULT 0 CHECK (views >= 0),
        engagements bigint NOT NULL DEFAULT 0 CHECK (engagements >= 0),
        clicks bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
        conversions bigint NOT NULL DEFAULT 0 CHECK (conversions >= 0),
        watch_time_seconds bigint NOT NULL DEFAULT 0 CHECK (watch_time_seconds >= 0),
        notes text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (campaign_id, asset_id)
      )
    `;
    await sql`
      ALTER TABLE content_performance
      DROP CONSTRAINT IF EXISTS content_performance_platform_check
    `;
    await sql`
      ALTER TABLE content_performance
      ADD CONSTRAINT content_performance_platform_check
      CHECK (platform IN ('X', 'LinkedIn', 'Newsletter', 'Discord', 'Mirror', 'Medium', 'Instagram', 'TikTok'))
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS content_performance_campaign_idx
      ON content_performance (campaign_id, updated_at DESC)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS content_performance_brand_lookup_idx
      ON campaign_runs (lower(btrim(brand)))
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS campaign_visual_assets (
        campaign_id text NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
        visual_brief_id text NOT NULL,
        asset_id text NOT NULL,
        mime_type text NOT NULL,
        image_base64 text NOT NULL,
        model text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (campaign_id, visual_brief_id)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS campaign_visual_assets_campaign_idx
      ON campaign_visual_assets (campaign_id, created_at DESC)
    `;
    // Heading-delimited source sections, searchable with Postgres full-text search. body keeps the
    // original markdown for quote checks; plain_text drops images and link targets for search.
    await sql`
      CREATE TABLE IF NOT EXISTS source_sections (
        campaign_id text NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
        section_id text NOT NULL,
        source_id text NOT NULL,
        heading text NOT NULL,
        body text NOT NULL,
        plain_text text NOT NULL,
        position integer NOT NULL,
        search_vector tsvector GENERATED ALWAYS AS (
          setweight(to_tsvector('english', heading), 'A') || setweight(to_tsvector('english', plain_text), 'B')
        ) STORED,
        PRIMARY KEY (campaign_id, section_id)
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS source_sections_search_idx
      ON source_sections USING gin (search_vector)
    `;
    await sql`
      INSERT INTO campaign_stage_artifacts (
        campaign_id,
        stage,
        position,
        label,
        status,
        started_at,
        completed_at,
        duration_ms,
        output_keys,
        artifact
      )
      SELECT
        run.id,
        stage_data.value->>'stage',
        CASE stage_data.value->>'stage'
          WHEN 'foundation' THEN 1
          WHEN 'architecture' THEN 2
          WHEN 'execution' THEN 3
          WHEN 'editorial' THEN 4
          WHEN 'governance' THEN 5
        END,
        COALESCE(stage_data.value->>'label', initcap(stage_data.value->>'stage')),
        stage_data.value->>'status',
        (stage_data.value->>'startedAt')::timestamptz,
        (stage_data.value->>'completedAt')::timestamptz,
        (stage_data.value->>'durationMs')::integer,
        COALESCE(stage_data.value->'outputKeys', '[]'::jsonb),
        CASE stage_data.value->>'stage'
          WHEN 'foundation' THEN jsonb_build_object(
            'brandContext', run.delivery_pack->'brandContext',
            'contentLandscape', run.delivery_pack->'contentLandscape',
            'audienceSegments', run.delivery_pack->'audienceSegments',
            'territories', run.delivery_pack->'territories'
          )
          WHEN 'architecture' THEN jsonb_build_object(
            'hooks', run.delivery_pack->'hooks',
            'contentSeries', run.delivery_pack->'contentSeries',
            'platformAdaptations', run.delivery_pack->'platformAdaptations'
          )
          WHEN 'execution' THEN jsonb_build_object(
            'calendar', run.delivery_pack->'calendar',
            'assets', run.delivery_pack->'assets'
          )
          WHEN 'editorial' THEN jsonb_build_object(
            'editorialMix', COALESCE(run.delivery_pack->'editorialMix', '[]'::jsonb),
            'assets', run.delivery_pack->'assets',
            'editorialReport', run.delivery_pack->'editorialReport',
            'visualBriefs', COALESCE(run.delivery_pack->'visualBriefs', '[]'::jsonb)
          )
          WHEN 'governance' THEN jsonb_build_object(
            'claims', run.delivery_pack#>'{proofReport,claims}',
            'assetClaimLinks', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'assetId', asset.value->>'id',
                'claimIds', COALESCE(asset.value->'linkedClaims', '[]'::jsonb)
              ))
              FROM jsonb_array_elements(COALESCE(run.delivery_pack->'assets', '[]'::jsonb)) AS asset(value)
            ), '[]'::jsonb),
            'productionPlan', run.delivery_pack->'productionPlan'
          )
        END
      FROM campaign_runs AS run
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(run.delivery_pack->'generationStages') = 'array'
            THEN run.delivery_pack->'generationStages'
          ELSE '[]'::jsonb
        END
      ) AS stage_data(value)
      WHERE stage_data.value->>'stage' IN ('foundation', 'architecture', 'execution', 'editorial', 'governance')
      ON CONFLICT (campaign_id, stage) DO NOTHING
    `;
  })().catch((error) => {
    // Let the next request retry instead of failing every request until restart.
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}
