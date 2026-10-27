import { randomUUID } from "node:crypto";
import type { Tracer } from "./trace";
import { silentTracer } from "./trace";
import type { ZetarisResult, ZetarisRunner } from "./zetaris";

// Sample mode replays Zetaris responses recorded from a live run, so a reviewer without a Zetaris
// instance still sees the agent reason over real rows. Responses are keyed by the query's purpose
// ("claim_risk:linear.app") and its order within that purpose, never by SQL text, because
// session table names change per run.

export type ZetarisRecording = Record<string, Array<Omit<ZetarisResult, "queryId">>>;

export function recordingRunner(inner: ZetarisRunner, recording: ZetarisRecording): ZetarisRunner {
  return async (sql, options = {}) => {
    const result = await inner(sql, options);
    const key = options.purpose ?? sql;
    const { queryId: _queryId, ...stored } = result;
    void _queryId;
    (recording[key] ??= []).push({ ...stored, sql: options.traceSql ?? sql });
    return result;
  };
}

export function replayRunner(recording: ZetarisRecording, tracer: Tracer = silentTracer): ZetarisRunner {
  const used = new Map<string, number>();
  return async (sql, options = {}) => {
    const key = options.purpose ?? sql;
    const index = used.get(key) ?? 0;
    const stored = recording[key]?.[index];
    if (!stored) throw new Error("Sample mode has no recorded Zetaris response for " + key + " (call " + (index + 1) + ").");
    used.set(key, index + 1);
    const queryId = "replay-" + randomUUID();
    // Replayed queries are traced like live ones, marked as replayed.
    tracer.write("trace", "zetaris", "query.start", { queryId, purpose: key, sql: stored.sql, replayed: true });
    tracer.write("telemetry", "zetaris", "query", { queryId, purpose: key, rows: stored.rows.length, zetarisTimeMs: stored.timeUsedMs, replayed: true });
    return { ...stored, queryId };
  };
}
