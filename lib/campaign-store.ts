import { randomUUID } from "node:crypto";
import { DeliveryPackSchema, type DeliveryPack, type GenerationStage } from "./schemas";
import { ensureCampaignSchema, getDatabase } from "./db";
import { isEvidenceSource } from "./proof";
import { plainText, splitIntoSections } from "./sections";

export type CampaignSummary = {
  id: string;
  brand: string;
  goal: string;
  provider: string;
  model: string;
  createdAt: string;
};

export type PersistedStageArtifact = {
  campaignId: string;
  position: number;
  metadata: GenerationStage;
  artifact: unknown;
  createdAt: string;
};

type CampaignRow = {
  id: string;
  brand: string;
  goal: string;
  provider: string;
  model: string;
  created_at: string | Date;
};

type CampaignPackRow = CampaignRow & {
  delivery_pack: unknown;
};

type StageArtifactRow = {
  campaign_id: string;
  stage: GenerationStage["stage"];
  position: number;
  label: string;
  status: GenerationStage["status"];
  started_at: string | Date;
  completed_at: string | Date;
  duration_ms: number;
  output_keys: unknown;
  artifact: unknown;
  created_at: string | Date;
};

const stagePositions: Record<GenerationStage["stage"], number> = {
  foundation: 1,
  architecture: 2,
  execution: 3,
  editorial: 4,
  governance: 5,
  verification: 6
};

function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function toSummary(row: CampaignRow): CampaignSummary {
  return {
    id: row.id,
    brand: row.brand,
    goal: row.goal,
    provider: row.provider,
    model: row.model,
    createdAt: new Date(row.created_at).toISOString()
  };
}

function toStageArtifact(row: StageArtifactRow): PersistedStageArtifact {
  return {
    campaignId: row.campaign_id,
    position: row.position,
    metadata: {
      stage: row.stage,
      label: row.label,
      status: row.status,
      startedAt: new Date(row.started_at).toISOString(),
      completedAt: new Date(row.completed_at).toISOString(),
      durationMs: row.duration_ms,
      outputKeys: parseJson<string[]>(row.output_keys)
    },
    artifact: parseJson(row.artifact),
    createdAt: new Date(row.created_at).toISOString()
  };
}

function buildStageArtifacts(pack: DeliveryPack) {
  const artifacts: Record<GenerationStage["stage"], unknown> = {
    foundation: {
      brandContext: pack.brandContext,
      contentLandscape: pack.contentLandscape,
      audienceSegments: pack.audienceSegments,
      territories: pack.territories
    },
    architecture: {
      hooks: pack.hooks,
      contentSeries: pack.contentSeries,
      platformAdaptations: pack.platformAdaptations
    },
    execution: {
      calendar: pack.calendar,
      draftAssets: pack.draftAssets.length ? pack.draftAssets : pack.assets
    },
    editorial: {
      editorialMix: pack.editorialMix,
      assets: pack.assets,
      editorialReport: pack.editorialReport,
      visualBriefs: pack.visualBriefs
    },
    governance: {
      claims: pack.proofReport.claims,
      assetClaimLinks: pack.assets.map((asset) => ({
        assetId: asset.id,
        claimIds: asset.linkedClaims
      })),
      productionPlan: pack.productionPlan
    },
    verification: {
      webVerifiedClaims: pack.proofReport.claims.filter((claim) => claim.sourceType === "web-search"),
      webSources: pack.sources.filter((source) => source.sourceType === "web-search")
    }
  };

  return pack.generationStages
    .map((metadata) => ({
      position: stagePositions[metadata.stage],
      metadata,
      artifact: artifacts[metadata.stage]
    }))
    .sort((left, right) => left.position - right.position);
}

function buildStageQueries(
  sql: ReturnType<typeof getDatabase>,
  campaignId: string,
  pack: DeliveryPack
) {
  return buildStageArtifacts(pack).map((stageArtifact) => {
    const outputKeysJson = JSON.stringify(stageArtifact.metadata.outputKeys);
    const artifactJson = JSON.stringify(stageArtifact.artifact);
    return sql`
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
      ) VALUES (
        ${campaignId},
        ${stageArtifact.metadata.stage},
        ${stageArtifact.position},
        ${stageArtifact.metadata.label},
        ${stageArtifact.metadata.status},
        ${stageArtifact.metadata.startedAt},
        ${stageArtifact.metadata.completedAt},
        ${stageArtifact.metadata.durationMs},
        ${outputKeysJson}::jsonb,
        ${artifactJson}::jsonb
      )
      ON CONFLICT (campaign_id, stage) DO UPDATE SET
        position = EXCLUDED.position,
        label = EXCLUDED.label,
        status = EXCLUDED.status,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        duration_ms = EXCLUDED.duration_ms,
        output_keys = EXCLUDED.output_keys,
        artifact = EXCLUDED.artifact
    `;
  });
}

// Replaces the campaign's searchable sections with those of its current sources.
function buildSectionQueries(
  sql: ReturnType<typeof getDatabase>,
  campaignId: string,
  pack: DeliveryPack
) {
  const sectionsJson = JSON.stringify(
    pack.sources.filter(isEvidenceSource).flatMap(splitIntoSections).map((section) => ({
      section_id: section.id,
      source_id: section.sourceId,
      heading: section.heading,
      body: section.text,
      plain_text: plainText(section.text),
      position: section.position
    }))
  );
  return [
    sql`DELETE FROM source_sections WHERE campaign_id = ${campaignId}`,
    sql`
      INSERT INTO source_sections (campaign_id, section_id, source_id, heading, body, plain_text, position)
      SELECT ${campaignId}, section_id, source_id, heading, body, plain_text, position
      FROM jsonb_to_recordset(${sectionsJson}::jsonb)
        AS section(section_id text, source_id text, heading text, body text, plain_text text, position integer)
    `
  ];
}

export async function saveCampaign(pack: DeliveryPack, id: string = randomUUID()) {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const briefJson = JSON.stringify(pack.brief);
  const packJson = JSON.stringify(pack);
  const campaignQuery = sql`
    INSERT INTO campaign_runs (
      id, brand, goal, provider, model, brief, delivery_pack
    ) VALUES (
      ${id},
      ${pack.brief.brand},
      ${pack.brief.goal},
      ${pack.generation.provider},
      ${pack.generation.model},
      ${briefJson}::jsonb,
      ${packJson}::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET
      brand = EXCLUDED.brand,
      goal = EXCLUDED.goal,
      provider = EXCLUDED.provider,
      model = EXCLUDED.model,
      brief = EXCLUDED.brief,
      delivery_pack = EXCLUDED.delivery_pack
    RETURNING id, brand, goal, provider, model, created_at
  `;

  const results = await sql.transaction([
    campaignQuery,
    ...buildStageQueries(sql, id, pack),
    ...buildSectionQueries(sql, id, pack)
  ]);
  const rows = results[0] as CampaignRow[];
  if (!rows[0]) throw new Error("Campaign save returned no database row.");

  return toSummary(rows[0]);
}

export async function updateCampaignPack(id: string, pack: DeliveryPack) {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const briefJson = JSON.stringify(pack.brief);
  const packJson = JSON.stringify(pack);
  const campaignQuery = sql`
    UPDATE campaign_runs
    SET
      brand = ${pack.brief.brand},
      goal = ${pack.brief.goal},
      provider = ${pack.generation.provider},
      model = ${pack.generation.model},
      brief = ${briefJson}::jsonb,
      delivery_pack = ${packJson}::jsonb
    WHERE id = ${id}
    RETURNING id, brand, goal, provider, model, created_at
  `;

  const results = await sql.transaction([
    campaignQuery,
    ...buildStageQueries(sql, id, pack),
    ...buildSectionQueries(sql, id, pack)
  ]);
  const rows = results[0] as CampaignRow[];
  if (!rows[0]) throw new Error("Campaign not found.");

  return toSummary(rows[0]);
}
export async function listCampaigns(limit = 50) {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const rows = await sql`
    SELECT id, brand, goal, provider, model, created_at
    FROM campaign_runs
    ORDER BY created_at DESC
    LIMIT ${safeLimit}
  ` as CampaignRow[];

  return rows.map(toSummary);
}

export async function getCampaignStageArtifacts(campaignId: string) {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const rows = await sql`
    SELECT
      campaign_id,
      stage,
      position,
      label,
      status,
      started_at,
      completed_at,
      duration_ms,
      output_keys,
      artifact,
      created_at
    FROM campaign_stage_artifacts
    WHERE campaign_id = ${campaignId}
    ORDER BY position ASC
  ` as StageArtifactRow[];

  return rows.map(toStageArtifact);
}

export async function getCampaign(id: string) {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const rows = await sql`
    SELECT id, brand, goal, provider, model, delivery_pack, created_at
    FROM campaign_runs
    WHERE id = ${id}
    LIMIT 1
  ` as CampaignPackRow[];

  if (!rows[0]) return null;
  const pack = DeliveryPackSchema.parse(parseJson(rows[0].delivery_pack));
  const stageArtifacts = await getCampaignStageArtifacts(id);

  return {
    summary: toSummary(rows[0]),
    pack,
    stageArtifacts
  };
}

export type SectionSearchResult = {
  sectionId: string;
  sourceId: string;
  heading: string;
  snippet: string;
  rank: number;
};

type SectionSearchRow = { section_id: string; source_id: string; heading: string; snippet: string; rank: number };

// Full-text search over one campaign's source sections. Campaigns saved before sections were
// stored are indexed on their first search.
export async function searchCampaignSections(campaignId: string, pack: DeliveryPack, query: string, limit = 10) {
  await ensureCampaignSchema();
  const sql = getDatabase();
  const [{ count }] = await sql`
    SELECT count(*)::int AS count FROM source_sections WHERE campaign_id = ${campaignId}
  ` as Array<{ count: number }>;
  if (!count) await sql.transaction(buildSectionQueries(sql, campaignId, pack));

  // Pages often repeat the same block (navigation, app screens); show each passage once.
  const rows = await sql`
    SELECT section_id, source_id, heading, snippet, rank
    FROM (
      SELECT DISTINCT ON (md5(plain_text))
        section_id,
        source_id,
        heading,
        ts_headline(
          'english',
          plain_text,
          websearch_to_tsquery('english', ${query}),
          'StartSel=«, StopSel=», MaxWords=45, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "'
        ) AS snippet,
        ts_rank(search_vector, websearch_to_tsquery('english', ${query})) AS rank
      FROM source_sections
      WHERE campaign_id = ${campaignId}
        AND search_vector @@ websearch_to_tsquery('english', ${query})
      ORDER BY md5(plain_text), section_id
    ) AS distinct_sections
    ORDER BY rank DESC, section_id
    LIMIT ${Math.max(1, Math.min(limit, 25))}
  ` as SectionSearchRow[];

  return rows.map((row): SectionSearchResult => ({
    sectionId: row.section_id,
    sourceId: row.source_id,
    heading: row.heading,
    snippet: row.snippet,
    rank: Number(row.rank)
  }));
}
