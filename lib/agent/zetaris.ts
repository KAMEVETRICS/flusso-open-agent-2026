import { randomUUID } from "node:crypto";
import process from "node:process";
import type { Env } from "../model-provider";
import type { Tracer } from "./trace";
import { silentTracer } from "./trace";

// Client for the Zetaris Lightning REST API (contract from zetaris/getting-started
// scripts/zetaris_sql.py). Every query is traced with its SQL, row count, and timing.

export type ZetarisConfig = { baseUrl: string; orgId: string; apiKey: string };

export type ZetarisResult = {
  queryId: string;
  sql: string;
  headers: string[];
  // Zetaris returns every cell as a string (or null).
  rows: Array<Record<string, string | null>>;
  total: number;
  timeUsedMs: number;
};

// traceSql is what traces show in place of the SQL; secrets are scrubbed from any error text.
export type ZetarisRunner = (sql: string, options?: { limit?: number; purpose?: string; traceSql?: string; secrets?: string[] }) => Promise<ZetarisResult>;

const DEFAULT_TIMEOUT_MS = 120_000;

export function zetarisConfigFromEnv(env: Env = process.env): ZetarisConfig | null {
  const apiKey = env.ZETARIS_API_KEY?.trim();
  const baseUrl = env.ZETARIS_REST_URL?.trim();
  if (!apiKey || !baseUrl) return null;
  return { baseUrl: baseUrl.replace(/\/+$/, ""), orgId: env.ZETARIS_ORG_ID?.trim() || "1", apiKey };
}

export class ZetarisError extends Error {
  readonly status: number;
  readonly sql: string;

  constructor(status: number, sql: string, detail: string) {
    super("Zetaris query failed (HTTP " + status + "): " + detail);
    this.name = "ZetarisError";
    this.status = status;
    this.sql = sql;
  }
}

function headersFor(config: ZetarisConfig) {
  return {
    Authorization: "Bearer " + config.apiKey,
    "X-Org-ID": config.orgId,
    "X-Request-ID": randomUUID(),
    "Content-Type": "application/json"
  };
}

export function parseZetarisResponse(queryId: string, sql: string, payload: unknown): ZetarisResult {
  const body = payload as { headers?: unknown; data?: unknown; total?: unknown; timeUsed?: unknown };
  if (!Array.isArray(body?.headers) || !Array.isArray(body?.data)) {
    throw new ZetarisError(200, sql, "response has no headers/data arrays");
  }
  const headers = body.headers.map(String);
  const rows = body.data.map((cells) => {
    const values = Array.isArray(cells) ? cells : [];
    return Object.fromEntries(headers.map((header, index) => [header, values[index] == null ? null : String(values[index])]));
  });
  return {
    queryId,
    sql,
    headers,
    rows,
    total: typeof body.total === "number" ? body.total : rows.length,
    timeUsedMs: typeof body.timeUsed === "number" ? body.timeUsed : 0
  };
}

// Failures worth one more try: the Zetaris server erroring, or a federated source (Neon wakes its
// compute on first connect) refusing the connection. SQL errors are not retried.
export function isTransientZetarisError(error: ZetarisError) {
  return error.status === 0 || error.status >= 500 ||
    /connection attempt failed|connection refused|timed out|Connection reset/i.test(error.message);
}

const MAX_ATTEMPTS = 3;

export function createZetarisRunner(
  config: ZetarisConfig,
  tracer: Tracer = silentTracer,
  fetchImpl: typeof fetch = fetch,
  retryDelayMs = 2000
): ZetarisRunner {
  const attempt = async (queryId: string, sql: string, limit: number) => {
    let response: Response;
    try {
      response = await fetchImpl(config.baseUrl + "/sql-editor/sqls/run", {
        method: "POST",
        headers: headersFor(config),
        body: JSON.stringify({ queryId, sql, source: "SqlEditor", limit }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ZetarisError(0, sql, "could not reach " + config.baseUrl + " (" + message + ")");
    }
    const text = await response.text();
    if (!response.ok) throw new ZetarisError(response.status, sql, text.slice(0, 500));
    return text;
  };

  return async (sql, options = {}) => {
    const queryId = randomUUID();
    const started = Date.now();
    const shownSql = options.traceSql ?? sql;
    // Zetaris can echo the submitted SQL in an error; the masked SQL and the secrets the caller
    // names must not reach a trace or the caller's error.
    // Error bodies are JSON, so the echoed SQL may arrive escaped.
    const escaped = (value: string) => JSON.stringify(value).slice(1, -1);
    const redact = (text: string) => (options.secrets ?? [])
      .filter(Boolean)
      .reduce(
        (out, secret) => out.split(secret).join("***").split(escaped(secret)).join("***"),
        text.split(sql).join(shownSql).split(escaped(sql)).join(escaped(shownSql))
      );
    tracer.write("trace", "zetaris", "query.start", { queryId, purpose: options.purpose ?? "", sql: shownSql });
    let text: string | undefined;
    // Zetaris refuses a reused query ID, so each retry sends a fresh one; the attempt that
    // succeeds is the ID every later record and the evidence cite.
    let sentId = queryId;
    for (let tries = 1; text === undefined; tries += 1) {
      try {
        sentId = tries === 1 ? queryId : randomUUID();
        text = await attempt(sentId, sql, options.limit ?? 100);
      } catch (error) {
        const failure = error as ZetarisError;
        const safe = new ZetarisError(failure.status, shownSql, redact(failure.message.replace(/^Zetaris query failed \(HTTP \d+\): /, "")));
        const retry = tries < MAX_ATTEMPTS && isTransientZetarisError(failure);
        tracer.write("trace", "zetaris", retry ? "query.retry" : "query.error", { queryId: sentId, firstQueryId: queryId, attempt: tries, status: safe.status, error: safe.message.slice(0, 500) });
        if (!retry) throw safe;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * tries));
      }
    }
    const result = parseZetarisResponse(sentId, shownSql, JSON.parse(text));
    tracer.write("trace", "zetaris", "query.done", { queryId: sentId, firstQueryId: queryId, rows: result.rows.length, total: result.total });
    tracer.write("telemetry", "zetaris", "query", {
      queryId: sentId,
      purpose: options.purpose ?? "",
      rows: result.rows.length,
      zetarisTimeMs: result.timeUsedMs,
      wallTimeMs: Date.now() - started
    });
    return result;
  };
}

// Escapes a value for a single-quoted Spark SQL string literal.
export function sqlString(value: string) {
  return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}
