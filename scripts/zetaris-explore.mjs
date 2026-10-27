/* global console */
// Usage: npm run zetaris:explore
// Runs the exploratory queries for each Zetaris source, the queries that show the USL is active,
// and the data-quality rules, then writes the real results to docs/zetaris/exploration.md.
import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import { DQ_RULES, SIGNALS_DATABASE, signalTableName, uslTableName } from "../lib/agent/zetaris-catalog.ts";
import { createTracer, jsonlSink } from "../lib/agent/trace.ts";
import { createZetarisRunner, zetarisConfigFromEnv } from "../lib/agent/zetaris.ts";

const config = zetarisConfigFromEnv();
if (!config) {
  console.error("ZETARIS_REST_URL and ZETARIS_API_KEY are required in .env.local.");
  process.exit(64);
}
const tracer = createTracer("zetaris-explore-" + new Date().toISOString(), [jsonlSink("logs")]);
const run = createZetarisRunner(config, tracer);

const sections = [
  {
    title: "Source 1: Flusso campaign store (Neon Postgres, JDBC datasource `flusso_neon`)",
    queries: [
      ["Which datasource views exist", "SHOW DATASOURCE TABLES flusso_neon"],
      ["Campaigns per brand domain", "SELECT domain, count(*) AS campaigns, round(avg(editorial_score), 1) AS avg_editorial_score FROM flusso_neon.fl_campaign_history GROUP BY domain ORDER BY campaigns DESC"],
      ["Claim outcomes across every brand", "SELECT status, count(*) AS claims FROM flusso_neon.fl_claim_outcomes GROUP BY status ORDER BY claims DESC"],
      ["Captured source sections per brand", "SELECT domain, count(*) AS sections FROM flusso_neon.fl_evidence_sections GROUP BY domain ORDER BY sections DESC"]
    ]
  },
  {
    title: "Source 2: Hacker News search API (Lightning REST tables in `" + SIGNALS_DATABASE + "`)",
    queries: [
      ["Top Linear stories by points", "SELECT h.title, h.points, h.num_comments, substr(h.created_at, 1, 10) AS created FROM " + SIGNALS_DATABASE + "." + signalTableName("linear.app") + " LATERAL VIEW explode(hits) AS h ORDER BY h.points DESC LIMIT 5"],
      // One table per query: a UNION ALL across REST tables whose inferred JSON schemas differ fails
      // in Spark's struct converter.
      ["Allbirds stories and engagement", "SELECT count(*) AS stories, sum(h.points) AS points, sum(h.num_comments) AS comments, max(h.points) AS top_points FROM " +
        SIGNALS_DATABASE + "." + signalTableName("allbirds.com") + " LATERAL VIEW explode(hits) AS h"],
      ["Linear stories per year", "SELECT substr(h.created_at, 1, 4) AS year, count(*) AS stories FROM " + SIGNALS_DATABASE + "." + signalTableName("linear.app") + " LATERAL VIEW explode(hits) AS h GROUP BY substr(h.created_at, 1, 4) ORDER BY year DESC LIMIT 6"]
    ]
  },
  {
    title: "Source 3: Wikimedia pageviews API (REST session table, created and dropped per query)",
    session: {
      name: "fl_explore_wiki",
      endpoint: "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Allbirds/monthly/20260101/20261001"
    },
    queries: [
      ["Allbirds monthly article views in 2026", "SELECT substr(i.timestamp, 1, 6) AS month, i.views FROM session.fl_explore_wiki LATERAL VIEW explode(items) AS i ORDER BY month"],
      ["Peak and average month", "SELECT max(i.views) AS peak_views, round(avg(i.views)) AS avg_views, count(*) AS months FROM session.fl_explore_wiki LATERAL VIEW explode(items) AS i"]
    ]
  },
  {
    title: "The `brand_evidence` USL is active",
    queries: [
      ["Tables and activation state", "SHOW NAMESPACES OR TABLES IN lightning.metastore.flusso.brand_evidence"],
      ["Claim failure rate by kind, joined across USL tables", "SELECT o.claim_kind, count(*) AS claims, sum(CASE WHEN o.status IN ('unsupported', 'conflict') THEN 1 ELSE 0 END) AS failed FROM " + uslTableName("claim_outcome") + " o JOIN " + uslTableName("campaign") + " c ON o.campaign_id = c.campaign_id WHERE c.domain IS NOT NULL GROUP BY o.claim_kind ORDER BY failed DESC"],
      ["Evidence sections reused per campaign goal", "SELECT c.goal, count(e.evidence_id) AS sections FROM " + uslTableName("campaign") + " c JOIN " + uslTableName("evidence_section") + " e ON e.campaign_id = c.campaign_id WHERE c.domain = 'linear.app' GROUP BY c.goal"],
      ["Keys and data-quality rules", "LIST DQ USL lightning.metastore.flusso.brand_evidence"]
    ]
  },
  {
    title: "Data-quality rules executed",
    queries: [
      ...DQ_RULES.map((rule) => ["RUN DQ " + rule.name, "RUN DQ " + rule.name + " TABLE " + uslTableName(rule.table)]),
      ["Records failing campaign_has_domain", "SHOW DQ INVALID RECORD campaign_has_domain TABLE " + uslTableName("campaign")]
    ]
  }
];

function table(result) {
  if (!result.rows.length) return "_No rows._\n";
  const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 90);
  return "| " + result.headers.join(" | ") + " |\n| " + result.headers.map(() => "---").join(" | ") + " |\n" +
    result.rows.slice(0, 12).map((row) => "| " + result.headers.map((header) => cell(row[header])).join(" | ") + " |").join("\n") + "\n";
}

let markdown = "# Zetaris exploration results\n\nGenerated by `npm run zetaris:explore` on " + new Date().toISOString().slice(0, 16).replace("T", " ") +
  " UTC against the local Zetaris instance. Every table below is a real response.\n";
for (const section of sections) {
  markdown += "\n## " + section.title + "\n";
  if (section.session) {
    await run("CREATE REST SESSION TABLE " + section.session.name + " REQUEST (endpoint " + JSON.stringify(section.session.endpoint) +
      ", method \"GET\", http_encoding \"URLENCODED\", response_type \"JSON\", insecure_ssl \"false\") HEADER (\"User-Agent\" \"Flusso/0.3 (exploration)\") BODY ()", { purpose: "explore:create" });
  }
  try {
    for (const [label, sql] of section.queries) {
      const result = await run(sql, { purpose: "explore", limit: 20 });
      console.log("ok  " + label + " (" + result.rows.length + " rows, " + result.timeUsedMs + " ms)");
      markdown += "\n### " + label + "\n\n```sql\n" + sql + "\n```\n\n" + table(result) + "\n_" + result.rows.length + " rows in " + result.timeUsedMs + " ms._\n";
    }
  } finally {
    if (section.session) await run("DROP TABLE session." + section.session.name, { purpose: "explore:drop" });
  }
}
mkdirSync("docs/zetaris", { recursive: true });
writeFileSync("docs/zetaris/exploration.md", markdown);
console.log("Wrote docs/zetaris/exploration.md");
