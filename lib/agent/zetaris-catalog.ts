// The Zetaris objects Flusso's reasoning agent reads. Each datasource view runs native Postgres SQL
// on Flusso's Neon database (so jsonb is unpacked at the source), and the unified semantic layer
// (USL) gives the agent one typed model with keys between campaigns and their evidence.

export const ZETARIS_DATASOURCE = "flusso_neon";
export const ZETARIS_NAMESPACE = "lightning.metastore.flusso";
export const ZETARIS_USL = "brand_evidence";

// The brand website host without www, matching brandDomain() in lib/brand-model.ts. Brand names
// vary between runs ("Doma", "Doma Protocol"), so the domain is the key.
const DOMAIN_SQL =
  "lower(substring(COALESCE(r.brief->>'website', '') from '^[A-Za-z]+://(?:www[.])?([^/:?#]+)')) AS domain";

export type DatasourceView = { name: string; description: string; sql: string };

export const DATASOURCE_VIEWS: DatasourceView[] = [
  {
    name: "fl_campaign_history",
    description: "One row per finished campaign: brand, goal, editorial score, fact and gap counts.",
    sql: [
      "SELECT r.id AS campaign_id, r.brand, " + DOMAIN_SQL + ", r.goal,",
      "COALESCE((r.delivery_pack->'editorialReport'->>'score')::int, 0) AS editorial_score,",
      "COALESCE(jsonb_array_length(r.delivery_pack->'factSheet'->'facts'), 0) AS fact_count,",
      "COALESCE(jsonb_array_length(r.delivery_pack->'factSheet'->'gaps'), 0) AS gap_count,",
      "COALESCE(jsonb_array_length(r.delivery_pack->'proofReport'->'claims'), 0) AS claim_count,",
      "COALESCE(r.delivery_pack->'brief'->>'platforms', '[]') AS platforms,",
      "r.created_at",
      "FROM campaign_runs r"
    ].join(" ")
  },
  {
    name: "fl_claim_outcomes",
    description: "Every governed claim from past campaigns with its verification status and repair.",
    sql: [
      "SELECT r.id AS campaign_id, " + DOMAIN_SQL + ", c->>'id' AS claim_id,",
      "COALESCE(c->>'claimKind', 'unclassified') AS claim_kind, c->>'status' AS status,",
      "COALESCE(c->>'resolutionStatus', 'unresolved') AS resolution_status,",
      "COALESCE(c->>'repairAction', '') AS repair_action, left(c->>'text', 400) AS claim_text,",
      "left(COALESCE(c->>'recommendation', ''), 400) AS recommendation, COALESCE(c->>'sourceId', '') AS source_id,",
      "r.created_at",
      "FROM campaign_runs r CROSS JOIN LATERAL",
      "jsonb_array_elements(COALESCE(r.delivery_pack->'proofReport'->'claims', '[]'::jsonb)) c"
    ].join(" ")
  },
  {
    name: "fl_performance",
    description: "Measured asset performance joined to its campaign's brand.",
    sql: [
      "SELECT p.id AS performance_id, p.campaign_id, " + DOMAIN_SQL + ", p.platform, p.asset_type,",
      "p.hook_id, p.territory, p.impressions, p.engagements, p.clicks, p.conversions, p.updated_at",
      "FROM content_performance p JOIN campaign_runs r ON r.id = p.campaign_id"
    ].join(" ")
  },
  {
    name: "fl_evidence_sections",
    description: "Heading-delimited source sections captured in past campaigns, for evidence reuse.",
    sql: [
      "SELECT s.campaign_id || ':' || s.section_id AS evidence_id, s.campaign_id, " + DOMAIN_SQL + ",",
      "s.section_id, s.source_id, left(s.heading, 400) AS heading, left(s.plain_text, 600) AS excerpt, r.created_at",
      "FROM source_sections s JOIN campaign_runs r ON r.id = s.campaign_id"
    ].join(" ")
  }
];

type UslTable = { table: string; view: string; columns: Array<[name: string, type: string]> };

// USL tables and the view each one is activated from. Columns are scalar, as COMPILE USL requires.
// campaign_id references the campaign table.
export const USL_TABLES: UslTable[] = [
  {
    table: "campaign",
    view: "fl_campaign_history",
    columns: [
      ["campaign_id", "varchar(80) NOT NULL PRIMARY KEY"], ["brand", "varchar(200)"], ["domain", "varchar(200)"],
      ["goal", "varchar(1000)"], ["editorial_score", "int"], ["fact_count", "int"], ["gap_count", "int"],
      ["claim_count", "int"], ["platforms", "varchar(400)"], ["created_at", "timestamp"]
    ]
  },
  {
    table: "claim_outcome",
    view: "fl_claim_outcomes",
    columns: [
      ["campaign_id", "varchar(80) FOREIGN KEY REFERENCES campaign(campaign_id)"], ["domain", "varchar(200)"],
      ["claim_id", "varchar(80)"], ["claim_kind", "varchar(40)"], ["status", "varchar(40)"],
      ["resolution_status", "varchar(40)"], ["repair_action", "varchar(60)"], ["claim_text", "varchar(400)"],
      ["recommendation", "varchar(400)"], ["source_id", "varchar(200)"], ["created_at", "timestamp"]
    ]
  },
  {
    table: "performance",
    view: "fl_performance",
    columns: [
      ["performance_id", "varchar(120) NOT NULL PRIMARY KEY"],
      ["campaign_id", "varchar(80) FOREIGN KEY REFERENCES campaign(campaign_id)"], ["domain", "varchar(200)"],
      ["platform", "varchar(40)"], ["asset_type", "varchar(60)"], ["hook_id", "varchar(80)"], ["territory", "varchar(200)"],
      ["impressions", "bigint"], ["engagements", "bigint"], ["clicks", "bigint"], ["conversions", "bigint"],
      ["updated_at", "timestamp"]
    ]
  },
  {
    table: "evidence_section",
    view: "fl_evidence_sections",
    columns: [
      ["evidence_id", "varchar(300) NOT NULL PRIMARY KEY"],
      ["campaign_id", "varchar(80) FOREIGN KEY REFERENCES campaign(campaign_id)"], ["domain", "varchar(200)"],
      ["section_id", "varchar(200)"], ["source_id", "varchar(200)"], ["heading", "varchar(400)"],
      ["excerpt", "varchar(600)"], ["created_at", "timestamp"]
    ]
  }
];

export function uslTableName(table: string) {
  return ZETARIS_NAMESPACE + "." + ZETARIS_USL + "." + table;
}

function uslDdl(table: UslTable) {
  return "CREATE TABLE " + table.table + " (\n" +
    table.columns.map(([name, type]) => "  " + name + " " + type).join(",\n") + "\n)";
}

// Data-quality rules on the USL. The agent runs them before it trusts its evidence.
export const DQ_RULES = [
  {
    name: "claim_status_known",
    table: "claim_outcome",
    expression: "status IN ('supported', 'unsupported', 'conflict', 'time-sensitive', 'editorial') AND claim_text IS NOT NULL"
  },
  { name: "campaign_has_domain", table: "campaign", expression: "domain IS NOT NULL AND domain <> ''" }
];

// Live audience signals for the demo brands, registered as persistent REST tables so they can be
// explored in Zetaris. At run time the agent reads the same APIs through session tables.
export const SIGNALS_DATABASE = "flusso_signals";
export const DEMO_SIGNAL_DOMAINS = ["linear.app", "allbirds.com", "wise.com"];

export function signalTableName(domain: string) {
  return "hn_" + domain.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

export type JdbcConnection = { jdbcUrl: string; username: string; password: string };

// Every statement that sets Flusso up in Zetaris, in order. The connection is passed in so a dry
// run can print the plan with the credentials masked.
export function setupStatements(connection: JdbcConnection) {
  return [
    "CREATE DATASOURCE " + ZETARIS_DATASOURCE + " DESCRIBE BY \"Flusso campaign store, Neon Postgres\" OPTIONS (\n" +
      "  jdbcdriver \"org.postgresql.Driver\",\n" +
      "  jdbcurl \"" + connection.jdbcUrl + "\",\n" +
      "  username \"" + connection.username + "\",\n" +
      "  password \"" + connection.password + "\",\n" +
      "  fetchsize \"1000\"\n)",
    ...DATASOURCE_VIEWS.map((view) => "CREATE DATASOURCE VIEW " + view.name + " FROM " + ZETARIS_DATASOURCE + " AS " + view.sql),
    // A fresh instance has no lightning.metastore, and a USL namespace needs it as a parent.
    "CREATE NAMESPACE IF NOT EXISTS lightning.metastore",
    "CREATE NAMESPACE IF NOT EXISTS " + ZETARIS_NAMESPACE,
    "COMPILE USL " + ZETARIS_USL + " DEPLOY NAMESPACE " + ZETARIS_NAMESPACE + " DDL\n" + USL_TABLES.map(uslDdl).join(";\n"),
    ...USL_TABLES.map((table) => (
      "ACTIVATE USL TABLE " + uslTableName(table.table) + " AS SELECT " +
      // ACTIVATE rejects a nullable expression for a NOT NULL column, and view columns are nullable.
      table.columns.map(([name, type]) => (type.includes("NOT NULL") ? "COALESCE(" + name + ", '') AS " + name : name)).join(", ") +
      " FROM " + ZETARIS_DATASOURCE + "." + table.view
    )),
    ...DQ_RULES.map((rule) => "REGISTER DQ " + rule.name + " TABLE " + uslTableName(rule.table) + " AS " + rule.expression),
    "CREATE LIGHTNING DATABASE " + SIGNALS_DATABASE + " DESCRIBE BY \"Flusso audience signals, Hacker News\"",
    ...DEMO_SIGNAL_DOMAINS.map((domain) => (
      "CREATE LIGHTNING REST TABLE " + signalTableName(domain) + " FROM " + SIGNALS_DATABASE + " REQUEST (\n" +
      "  endpoint \"https://hn.algolia.com/api/v1/search?query=" + domain + "&tags=story&hitsPerPage=50\",\n" +
      "  method \"GET\", http_encoding \"URLENCODED\", response_type \"JSON\", insecure_ssl \"false\"\n) HEADER () BODY ()"
    ))
  ];
}

// Converts a Postgres connection string (postgresql://user:pass@host/db?sslmode=require) into
// the JDBC URL and credentials a Zetaris JDBC datasource takes.
export function jdbcFromDatabaseUrl(databaseUrl: string): JdbcConnection {
  const url = new URL(databaseUrl);
  return {
    jdbcUrl: "jdbc:postgresql://" + url.hostname + ":" + (url.port || "5432") + url.pathname + "?sslmode=require",
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password)
  };
}
