import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// The four JSONL streams the agent writes so a reviewer can replay its reasoning:
// audit (what changed in memory, world state, or Zetaris), trace (each reasoning step and tool
// call), telemetry (durations, counts, model usage), provenance (each decision's evidence chain).
export type TraceStream = "audit" | "trace" | "telemetry" | "provenance";

export type TraceRecord = {
  ts: string;
  runId: string;
  engine: string;
  event: string;
  [key: string]: unknown;
};

export type TraceSink = (stream: TraceStream, record: TraceRecord) => void;

// Appends each record as one line to logs/<stream>.jsonl under the given directory.
export function jsonlSink(directory: string): TraceSink {
  mkdirSync(directory, { recursive: true });
  return (stream, record) => {
    appendFileSync(path.join(directory, stream + ".jsonl"), JSON.stringify(record) + "\n", "utf8");
  };
}

// One readable line per trace record, for a terminal or container log.
export function stdoutSink(write: (line: string) => void = (line) => process.stdout.write(line + "\n")): TraceSink {
  return (stream, record) => {
    if (stream === "provenance") return;
    const { ts: _ts, runId, engine, event, ...rest } = record;
    void _ts;
    const detail = JSON.stringify(rest);
    write("[" + stream.toUpperCase() + "] run_id=" + runId + " " + engine + " " + event + " " + (detail.length > 220 ? detail.slice(0, 220) + "..." : detail));
  };
}

export function memorySink(records: Array<{ stream: TraceStream; record: TraceRecord }>): TraceSink {
  return (stream, record) => {
    records.push({ stream, record });
  };
}

export type Tracer = {
  runId: string;
  write(stream: TraceStream, engine: string, event: string, data?: Record<string, unknown>): void;
};

export function createTracer(runId: string, sinks: TraceSink[], clock: () => Date = () => new Date()): Tracer {
  return {
    runId,
    write(stream, engine, event, data = {}) {
      const record: TraceRecord = { ts: clock().toISOString(), runId, engine, event, ...data };
      for (const sink of sinks) sink(stream, record);
    }
  };
}

export const silentTracer: Tracer = { runId: "silent", write() {} };
