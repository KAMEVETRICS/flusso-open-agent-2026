"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentPlan, VerifiedDecision } from "@/lib/agent/schemas";
import styles from "./evidence-console.module.css";

// The Evidence Console: runs the evidence agent for a sample brand and shows its reasoning as it
// streams, from the data it read (Zetaris, World Model, H-MEM) to the decisions code verified.

type SampleId = "allbirds-newsletter" | "linear-asks" | "wise-freelancers";
type Mode = "live" | "replay";
type TraceRecord = { stream: string; ts: string; runId: string; engine: string; event: string; [key: string]: unknown };
type EvidenceEntry = { id: string; origin: string; tool: string; text: string; provenance: string };
type Health = { meterless: string; zetaris: string } | null;

const SAMPLES: Array<{ id: SampleId; brand: string; domain: string; goal: string }> = [
  { id: "allbirds-newsletter", brand: "Allbirds", domain: "allbirds.com", goal: "Grow newsletter signups ahead of a new running shoe launch" },
  { id: "linear-asks", brand: "Linear", domain: "linear.app", goal: "Get product teams to adopt Linear Asks for Slack requests" },
  { id: "wise-freelancers", brand: "Wise", domain: "wise.com", goal: "Get freelancers paid internationally to open a Wise account" }
];

const PHASES = [
  { id: "observe", label: "Observe", note: "World Model, H-MEM, DQ rules" },
  { id: "plan", label: "Plan", note: "Nemotron picks evidence tools" },
  { id: "act", label: "Act", note: "Zetaris queries and live sources" },
  { id: "decide", label: "Decide", note: "Nemotron proposes decisions" },
  { id: "verify", label: "Verify", note: "Code checks every citation" }
] as const;
type PhaseId = (typeof PHASES)[number]["id"];

const ENGINE_LABEL: Record<string, string> = {
  agent: "agent",
  zetaris: "zetaris",
  "world-model": "world model",
  "h-mem": "h-mem",
  model: "nightshift",
  verifier: "verifier"
};

function phaseOf(record: TraceRecord, current: PhaseId): PhaseId {
  if (record.engine === "agent" && record.event === "step.start") {
    if (record.step === "plan") return "plan";
    if (record.step === "decide" || record.step === "revise") return "decide";
  }
  if (record.engine === "agent" && record.event === "plan") return "act";
  if (record.engine === "verifier") return "verify";
  return current;
}

// One readable line per record worth showing; telemetry and query bookkeeping are summarised
// in the counters instead.
function describe(record: TraceRecord): string | null {
  const r = record as Record<string, unknown>;
  switch (record.engine + " " + record.event) {
    case "agent run.start": return "Run started for " + r.domain + " on " + r.provider;
    case "world-model ingest.fact-sheet": return "Ingested " + r.facts + " verified facts as world state" + ((r.gaps as string[])?.length ? ", gaps: " + (r.gaps as string[]).join(", ") : "");
    case "h-mem recall": return (r.recalled as string[]).length ? "Recalled " + (r.recalled as string[]).join(", ") + " from " + r.storeSize + " memories" : "No memories for this brand yet (" + r.storeSize + " stored)";
    case "zetaris data-quality": return "DQ " + (r.results as Array<{ rule: string; valid: number; total: number }>).map((rule) => rule.rule + " " + rule.valid + "/" + rule.total).join(", ");
    case "agent plan": return "Hypothesis: " + r.hypothesis;
    case "zetaris query.start": return String(r.purpose ?? "").startsWith("dq:") ? null : "SQL " + String(r.sql ?? "").replace(/\s+/g, " ").slice(0, 150);
    case "zetaris query.retry": return "Retrying query (attempt " + r.attempt + "): " + String(r.error ?? "").slice(0, 100);
    case "agent tool.result": return r.tool + " returned " + r.rows + " rows" + (r.note ? " - " + r.note : "");
    case "agent tool.error": return r.tool + " failed: " + String(r.error ?? "").slice(0, 120);
    case "world-model ingest.signals": return "Wrote " + r.written + " live signals into the world model";
    case "agent step.start": return "Asking the model to " + (r.step === "plan" ? "plan evidence" : r.step === "decide" ? "propose decisions" : "revise rejected decisions");
    case "verifier decision.accepted": return "Accepted " + r.decisionId + " (" + r.kind + ")" + (r.revised ? " after revision" : "");
    case "verifier decision.rejected": return "Rejected " + r.decisionId + ": " + (r.problems as string[]).join("; ");
    case "agent run.done": return "Done: " + r.accepted + " accepted, " + r.rejected + " rejected in " + (Number(r.durationMs) / 1000).toFixed(1) + "s";
    default: return null;
  }
}

async function readStream(response: Response, onEvent: (event: string, data: unknown) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The agent stream was unavailable.");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = block.split("\n").find((line) => line.startsWith("event: "))?.slice(7);
      const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (event && data) onEvent(event, JSON.parse(data));
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function StatusPill({ label, state }: { label: string; state: string }) {
  const tone = state === "online" || state === "configured" ? styles.ok : state === "checking" ? styles.dim : styles.warn;
  return <span className={styles.pill + " " + tone}><i />{label} <b>{state}</b></span>;
}

function DecisionCard({ decision, evidence, open, onToggle }: {
  decision: VerifiedDecision;
  evidence: EvidenceEntry[] | undefined;
  open: string | null;
  onToggle: (id: string | null) => void;
}) {
  const accepted = decision.status === "accepted";
  const opened = evidence?.find((entry) => entry.id === open);
  return (
    <article className={styles.decision + " " + (accepted ? styles.accepted : styles.rejected)}>
      <header>
        <span className={styles.verdict}>{accepted ? "Verified" : "Rejected"}</span>
        <span className={styles.kind}>{decision.kind.replace(/_/g, " ")}</span>
        {decision.revised ? <span className={styles.revised}>revised once</span> : null}
        <span className={styles.confidence}>{Math.round(decision.confidence)}%</span>
      </header>
      <p className={styles.statement}>{decision.statement}</p>
      <p className={styles.rationale}>{decision.rationale}</p>
      {decision.verification ? <p className={styles.verifierNote}>Verifier: {decision.verification}</p> : null}
      <div className={styles.chips}>
        {decision.evidenceIds.length ? decision.evidenceIds.map((id) => (
          <button
            key={id}
            type="button"
            className={styles.chip + " " + styles["chip_" + (id.startsWith("fact:") ? "world" : id.startsWith("mem-") ? "memory" : "zetaris")] + (open === id ? " " + styles.chipOpen : "")}
            onClick={() => onToggle(open === id ? null : id)}
            disabled={!evidence}
            aria-expanded={open === id}
          >
            {id}
          </button>
        )) : <span className={styles.noEvidence}>no evidence that exists</span>}
      </div>
      {opened ? (
        <div className={styles.provenance}>
          <div className={styles.provenanceHead}>{opened.origin} · {opened.tool}</div>
          <p>{opened.text.length > 420 ? opened.text.slice(0, 420) + "..." : opened.text}</p>
          <code>{opened.provenance}</code>
        </div>
      ) : null}
    </article>
  );
}

export function EvidenceConsole() {
  const [sample, setSample] = useState<SampleId>("allbirds-newsletter");
  const [mode, setMode] = useState<Mode>("replay");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<TraceRecord[]>([]);
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [phase, setPhase] = useState<PhaseId | null>(null);
  const [health, setHealth] = useState<Health>(null);
  const [open, setOpen] = useState<Record<string, string | null>>({});
  const feedRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((body) => setHealth(body.providers ?? null))
      .catch(() => setHealth({ meterless: "unreachable", zetaris: "unreachable" }));
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [records.length]);

  const stats = useMemo(() => {
    const queries = records.filter((record) => record.engine === "zetaris" && record.event === "query" && record.stream === "telemetry");
    const models = records.filter((record) => record.engine === "model" && record.event === "request");
    const recall = records.find((record) => record.engine === "h-mem" && record.event === "recall");
    const ingest = records.find((record) => record.engine === "world-model" && record.event === "ingest.fact-sheet");
    const signals = records.find((record) => record.engine === "world-model" && record.event === "ingest.signals");
    return {
      queries: queries.length,
      rows: queries.reduce((sum, record) => sum + Number(record.rows ?? 0), 0),
      zetarisMs: queries.reduce((sum, record) => sum + Number(record.zetarisTimeMs ?? 0), 0),
      facts: Number(ingest?.facts ?? 0),
      signals: Number(signals?.written ?? 0),
      memories: (recall?.recalled as string[] | undefined)?.length ?? 0,
      storeSize: Number(recall?.storeSize ?? 0),
      models: models.map((record) => ({ step: String(record.step), model: String(record.answeredBy), ms: Number(record.durationMs ?? 0), provider: String(record.provider) }))
    };
  }, [records]);

  const evidenceByDecision = useMemo(() => {
    const map = new Map<string, EvidenceEntry[]>();
    for (const record of records) {
      if (record.stream === "provenance" && record.event === "decision") map.set(String(record.decisionId), record.evidence as EvidenceEntry[]);
    }
    return map;
  }, [records]);

  const feed = useMemo(() => records
    .filter((record) => record.stream === "trace" || record.stream === "audit")
    .map((record, index) => ({ key: index, record, text: describe(record) }))
    .filter((item): item is { key: number; record: TraceRecord; text: string } => Boolean(item.text)), [records]);

  const dataQuality = records.find((record) => record.engine === "zetaris" && record.event === "data-quality")?.results as
    Array<{ rule: string; total: number; valid: number; invalid: number }> | undefined;
  const hypothesis = records.find((record) => record.engine === "agent" && record.event === "plan")?.hypothesis as string | undefined;
  const chosen = SAMPLES.find((item) => item.id === sample)!;

  async function run() {
    setRunning(true);
    setError(null);
    setRecords([]);
    setPlan(null);
    setOpen({});
    setPhase("observe");
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sample, mode })
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "The agent could not start.");
      await readStream(response, (event, data) => {
        if (event === "record") {
          const record = data as TraceRecord;
          setRecords((current) => [...current, record]);
          setPhase((current) => phaseOf(record, current ?? "observe"));
        } else if (event === "plan") {
          setPlan((data as { plan: AgentPlan }).plan);
          setPhase(null);
        } else if (event === "error") {
          throw new Error((data as { message: string }).message);
        }
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The agent run failed.");
      setPhase(null);
    } finally {
      setRunning(false);
    }
  }

  const phaseIndex = phase ? PHASES.findIndex((item) => item.id === phase) : plan ? PHASES.length : -1;
  const accepted = plan?.decisions.filter((decision) => decision.status === "accepted") ?? [];
  const rejected = plan?.decisions.filter((decision) => decision.status === "rejected") ?? [];

  return (
    <main className={styles.console}>
      <header className={styles.top}>
        <div className={styles.brand}>
          <span className={styles.mark} aria-hidden="true" />
          <span>Flusso</span>
          <span className={styles.crumb}>Evidence Console</span>
        </div>
        <div className={styles.pills}>
          <StatusPill label="Nightshift" state={health?.meterless ?? "checking"} />
          <StatusPill label="Zetaris" state={health?.zetaris ?? "checking"} />
          <Link className={styles.back} href="/">Campaign studio</Link>
        </div>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>Data · Knowledge · Memory · Reasoning</p>
        <h1>Decisions that cite their evidence, <em>checked by code.</em></h1>
        <p className={styles.lede}>
          Before Flusso writes a word, its agent reads the brand&apos;s history through Zetaris, its verified facts through the
          Meterless World Model, and its past lessons through H-MEM. Nemotron proposes. Code accepts only what the evidence supports.
        </p>
      </section>

      <section className={styles.controls} aria-label="Run the agent">
        <div className={styles.samples} role="radiogroup" aria-label="Brand">
          {SAMPLES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={sample === item.id}
              className={styles.sample + (sample === item.id ? " " + styles.sampleActive : "")}
              onClick={() => setSample(item.id)}
              disabled={running}
            >
              <span className={styles.sampleBrand}>{item.brand}</span>
              <span className={styles.sampleDomain}>{item.domain}</span>
              <span className={styles.sampleGoal}>{item.goal}</span>
            </button>
          ))}
        </div>
        <div className={styles.runBar}>
          <div className={styles.modes} role="radiogroup" aria-label="Mode">
            {(["live", "replay"] as const).map((item) => (
              <button key={item} type="button" role="radio" aria-checked={mode === item} className={mode === item ? styles.modeActive : ""} onClick={() => setMode(item)} disabled={running}>
                {item === "live" ? "Live: Zetaris + Nightshift" : "Replay recorded run"}
              </button>
            ))}
          </div>
          <button type="button" className={styles.run} onClick={run} disabled={running}>
            {running ? "Reasoning..." : "Run the evidence agent"}
          </button>
        </div>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
      </section>

      <ol className={styles.phases} aria-label="Agent phases">
        {PHASES.map((item, index) => (
          <li key={item.id} className={index < phaseIndex ? styles.phaseDone : index === phaseIndex ? styles.phaseNow : ""}>
            <span className={styles.phaseDot} />
            <span className={styles.phaseLabel}>{item.label}</span>
            <span className={styles.phaseNote}>{item.note}</span>
          </li>
        ))}
      </ol>

      <section className={styles.grid}>
        <div className={styles.panel + " " + styles.feedPanel}>
          <div className={styles.panelHead}>
            <span>Reasoning stream</span>
            <span className={styles.muted}>{records.length ? records.length + " trace records" : chosen.domain}</span>
          </div>
          {hypothesis ? <p className={styles.hypothesis}><span>Hypothesis</span>{hypothesis}</p> : null}
          <ol className={styles.feed} ref={feedRef} aria-live="polite">
            {feed.length ? feed.map(({ key, record, text }) => (
              <li key={key} className={styles["line_" + record.engine.replace("-", "")] ?? ""}>
                <span className={styles.lineTime}>{record.ts.slice(11, 19)}</span>
                <span className={styles.lineEngine}>{ENGINE_LABEL[record.engine] ?? record.engine}</span>
                <span className={styles.lineText}>{text}</span>
              </li>
            )) : <li className={styles.empty}>Pick a brand and run the agent. Replay needs no credentials.</li>}
          </ol>
        </div>

        <aside className={styles.engines}>
          <div className={styles.engine + " " + styles.engineZetaris}>
            <span className={styles.engineName}>Zetaris</span>
            <strong>{stats.queries}</strong><span>queries</span>
            <small>{stats.rows} rows · {(stats.zetarisMs / 1000).toFixed(1)}s in Zetaris · brand_evidence USL, Hacker News, Wikimedia</small>
          </div>
          <div className={styles.engine + " " + styles.engineWorld}>
            <span className={styles.engineName}>World Model</span>
            <strong>{stats.facts}</strong><span>facts</span>
            <small>{stats.signals} live signals added with Zetaris provenance</small>
          </div>
          <div className={styles.engine + " " + styles.engineMemory}>
            <span className={styles.engineName}>H-MEM</span>
            <strong>{stats.memories}</strong><span>recalled</span>
            <small>{stats.storeSize} memories stored for this brand</small>
          </div>
          <div className={styles.engine + " " + styles.engineModel}>
            <span className={styles.engineName}>Nightshift → NVIDIA</span>
            <strong>{stats.models.length}</strong><span>model calls</span>
            <small>
              {stats.models.length
                ? stats.models.map((call) => call.step + ": " + call.model.replace("nvidia/", "") + (call.ms ? " " + (call.ms / 1000).toFixed(0) + "s" : "")).join(" · ")
                : "Nemotron 3 Ultra through Meterless Nightshift"}
            </small>
          </div>
          {dataQuality ? (
            <div className={styles.dq}>
              <span className={styles.engineName}>Data quality, before trusting evidence</span>
              {dataQuality.map((rule) => (
                <div key={rule.rule} className={styles.dqRow}>
                  <code>{rule.rule}</code>
                  <span className={styles.dqBar}><i style={{ width: (rule.total ? (rule.valid / rule.total) * 100 : 0) + "%" }} /></span>
                  <span>{rule.valid}/{rule.total}</span>
                </div>
              ))}
            </div>
          ) : null}
        </aside>
      </section>

      {plan ? (
        <section className={styles.decisions} aria-label="Decisions">
          <div className={styles.decisionsHead}>
            <h2>{accepted.length} decisions the campaign must follow</h2>
            <p>
              {rejected.length ? rejected.length + " rejected by the verifier and kept visible. " : "None rejected. "}
              Click an evidence ID to see the row, fact, or memory behind it.
            </p>
          </div>
          <div className={styles.cards}>
            {[...accepted, ...rejected].map((decision, index) => (
              <DecisionCard
                key={decision.id + index}
                decision={decision}
                evidence={evidenceByDecision.get(decision.id)}
                open={open[decision.id + index] ?? null}
                onToggle={(id) => setOpen((current) => ({ ...current, [decision.id + index]: id }))}
              />
            ))}
          </div>
          {plan.openQuestions.length ? (
            <div className={styles.questions}>
              <span className={styles.engineName}>What the evidence could not answer</span>
              <ul>{plan.openQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <footer className={styles.footer}>
        Run {plan?.runId ?? "not started"} · every record above is also written to logs/ as JSONL
      </footer>
    </main>
  );
}
