import { createHash } from "node:crypto";
import { DQ_RULES, uslTableName } from "./zetaris-catalog";
import { TOOL_NAMES } from "./schemas";
import type { ToolName } from "./schemas";
import type { ZetarisResult, ZetarisRunner } from "./zetaris";
import { sqlString } from "./zetaris";

// The evidence tools the reasoning agent may call. Each one is a fixed, parameterised Zetaris
// query, so the model chooses what to look at but never writes SQL. Rows come back with stable
// evidence IDs ("claim_risk#2") that decisions must cite.

export { TOOL_NAMES };
export type { ToolName };

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  campaign_history: "Past Flusso campaigns for this domain: goal, editorial score, fact, gap and claim counts.",
  claim_risk: "How this brand's past claims fared in governance, counted by claim kind and verification status.",
  claim_risk_baseline: "The same claim outcome counts across every brand Flusso has run, as a baseline.",
  unsupported_claims: "The most recent claims for this brand that verification found unsupported or in conflict, with the reviewer's recommendation.",
  performance: "Measured content performance for this brand by platform and asset type.",
  prior_evidence: "Source sections captured in this brand's past campaigns that match the given search terms.",
  audience_signals: "Live Hacker News stories that link to the brand's domain, ranked by points: what the audience engages with.",
  attention_trend: "Live monthly English Wikipedia pageviews for the brand's article over the last three months."
};

export type ToolCall = { tool: ToolName; terms?: string[] };
export type ToolContext = { domain: string; brand: string; runTag: string; now: Date };

export type EvidenceRow = {
  id: string;
  tool: ToolName;
  queryId: string;
  data: Record<string, string | null>;
};

export type ToolResult = {
  tool: ToolName;
  queries: Array<{ queryId: string; sql: string; rows: number; timeUsedMs: number }>;
  rows: EvidenceRow[];
  note: string;
};

const usl = uslTableName;

function cleanTerms(terms: string[] = []) {
  return [...new Set(terms.map((term) => term.toLowerCase().replace(/[^a-z0-9 .-]/g, " ").trim()).filter((term) => term.length >= 3))]
    .slice(0, 5);
}

function compactDate(date: Date) {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

export function sessionName(prefix: string, ctx: ToolContext) {
  // A hash of the whole run tag: run IDs share long prefixes, so a truncated one would collide.
  return prefix + "_" + createHash("sha256").update(ctx.runTag).digest("hex").slice(0, 16);
}

function restRequest(endpoint: string) {
  return "REQUEST (endpoint " + JSON.stringify(endpoint) + ", method \"GET\", http_encoding \"URLENCODED\", " +
    "response_type \"JSON\", insecure_ssl \"false\") HEADER (\"User-Agent\" \"Flusso/0.3 (evidence agent)\") BODY ()";
}

function toRows(tool: ToolName, result: ZetarisResult, offset = 0): EvidenceRow[] {
  return result.rows.map((data, index) => ({ id: tool + "#" + (offset + index + 1), tool, queryId: result.queryId, data }));
}

function summarize(result: ZetarisResult) {
  return { queryId: result.queryId, sql: result.sql, rows: result.rows.length, timeUsedMs: result.timeUsedMs };
}

// Runs a live REST source as a Zetaris session table: create it, read it with SQL, then drop it,
// even when the read fails.
async function withSessionTable(
  run: ZetarisRunner,
  name: string,
  endpoint: string,
  purpose: string,
  read: (table: string) => Promise<ZetarisResult>
) {
  const created = await run("CREATE REST SESSION TABLE " + name + " " + restRequest(endpoint), { purpose: purpose + ":create", limit: 1 });
  try {
    return { created, result: await read("session." + name) };
  } finally {
    await run("DROP TABLE session." + name, { purpose: purpose + ":drop", limit: 1 });
  }
}

export async function runEvidenceTool(run: ZetarisRunner, call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
  const domain = sqlString(ctx.domain);
  const purpose = call.tool + ":" + ctx.domain;
  const single = async (sql: string, note = ""): Promise<ToolResult> => {
    const result = await run(sql, { purpose, limit: 50 });
    return { tool: call.tool, queries: [summarize(result)], rows: toRows(call.tool, result), note };
  };

  switch (call.tool) {
    case "campaign_history":
      return single(
        "SELECT campaign_id, brand, goal, editorial_score, fact_count, gap_count, claim_count, created_at FROM " +
        usl("campaign") + " WHERE domain = " + domain + " ORDER BY created_at DESC LIMIT 10"
      );
    case "claim_risk":
      return single(
        "SELECT o.claim_kind, o.status, count(*) AS claims, " +
        "sum(CASE WHEN o.resolution_status = 'repaired' THEN 1 ELSE 0 END) AS repaired FROM " +
        usl("claim_outcome") + " o JOIN " + usl("campaign") + " c ON o.campaign_id = c.campaign_id " +
        "WHERE c.domain = " + domain + " GROUP BY o.claim_kind, o.status ORDER BY claims DESC"
      );
    case "claim_risk_baseline":
      return single(
        "SELECT claim_kind, count(*) AS claims, " +
        "sum(CASE WHEN status IN ('unsupported', 'conflict') THEN 1 ELSE 0 END) AS failed, " +
        "round(100 * sum(CASE WHEN status IN ('unsupported', 'conflict') THEN 1 ELSE 0 END) / count(*), 1) AS failed_pct FROM " +
        usl("claim_outcome") + " WHERE claim_kind <> 'unclassified' GROUP BY claim_kind ORDER BY failed_pct DESC"
      );
    case "unsupported_claims":
      return single(
        "SELECT claim_kind, status, resolution_status, claim_text, recommendation, created_at FROM " + usl("claim_outcome") +
        " WHERE domain = " + domain + " AND status IN ('unsupported', 'conflict') ORDER BY created_at DESC LIMIT 12"
      );
    case "performance":
      return single(
        "SELECT platform, asset_type, count(*) AS assets, sum(impressions) AS impressions, sum(engagements) AS engagements, " +
        "sum(clicks) AS clicks, sum(conversions) AS conversions FROM " + usl("performance") +
        " WHERE domain = " + domain + " GROUP BY platform, asset_type ORDER BY engagements DESC",
        "Performance rows exist only for assets someone has measured and entered."
      );
    case "prior_evidence": {
      const terms = cleanTerms(call.terms);
      if (!terms.length) return { tool: call.tool, queries: [], rows: [], note: "No usable search terms were given." };
      const match = terms.map((term) => "lower(excerpt) LIKE " + sqlString("%" + term + "%")).join(" OR ");
      return single(
        "SELECT evidence_id, heading, excerpt FROM " + usl("evidence_section") +
        " WHERE domain = " + domain + " AND (" + match + ") ORDER BY created_at DESC LIMIT 10",
        "Search terms: " + terms.join(", ")
      );
    }
    case "audience_signals": {
      const endpoint = "https://hn.algolia.com/api/v1/search?query=" + encodeURIComponent(ctx.domain) + "&tags=story&hitsPerPage=50";
      const { created, result } = await withSessionTable(run, sessionName("fl_hn", ctx), endpoint, purpose, (table) => run(
        "SELECT h.title, h.points, h.num_comments, substr(h.created_at, 1, 10) AS created, h.url FROM " + table +
        " LATERAL VIEW explode(hits) AS h WHERE h.url LIKE " + sqlString("%" + ctx.domain + "%") +
        " ORDER BY h.points DESC LIMIT 12",
        { purpose, limit: 12 }
      ));
      return { tool: call.tool, queries: [summarize(created), summarize(result)], rows: toRows(call.tool, result), note: "Source: Hacker News search API via a Zetaris REST session table." };
    }
    case "attention_trend": {
      const search = "https://en.wikipedia.org/w/rest.php/v1/search/title?q=" + encodeURIComponent(ctx.brand) + "&limit=1";
      const found = await withSessionTable(run, sessionName("fl_wikis", ctx), search, purpose, (table) => run(
        "SELECT p.key, p.title, p.description FROM " + table + " LATERAL VIEW explode(pages) AS p",
        { purpose, limit: 1 }
      ));
      const article = found.result.rows[0]?.key;
      const queries = [summarize(found.created), summarize(found.result)];
      if (!article) return { tool: call.tool, queries, rows: [], note: "No Wikipedia article matched " + ctx.brand + "." };
      const end = ctx.now;
      const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 2, 1));
      const views = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/" +
        encodeURIComponent(article) + "/daily/" + compactDate(start) + "/" + compactDate(end);
      const trend = await withSessionTable(run, sessionName("fl_wikiv", ctx), views, purpose, (table) => run(
        "SELECT substr(i.timestamp, 1, 6) AS month, sum(i.views) AS views, count(*) AS days FROM " + table +
        " LATERAL VIEW explode(items) AS i GROUP BY substr(i.timestamp, 1, 6) ORDER BY month",
        { purpose, limit: 6 }
      ));
      return {
        tool: call.tool,
        queries: [...queries, summarize(trend.created), summarize(trend.result)],
        rows: toRows(call.tool, trend.result),
        note: "Wikipedia article: " + found.result.rows[0]?.title + " (" + (found.result.rows[0]?.description ?? "") + "). Check it is the brand."
      };
    }
  }
}

// Runs the USL data-quality rules before the agent trusts its evidence.
export async function runDataQuality(run: ZetarisRunner) {
  const results = [];
  for (const rule of DQ_RULES) {
    const result = await run("RUN DQ " + rule.name + " TABLE " + usl(rule.table), { purpose: "dq:" + rule.name, limit: 5 });
    results.push({ rule: rule.name, table: rule.table, queryId: result.queryId, rows: result.rows });
  }
  return results;
}
