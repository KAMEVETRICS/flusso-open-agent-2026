"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  ChartLineUp,
  Check,
  ClockCounterClockwise,
  Copy,
  DownloadSimple,
  FileText,
  FlagCheckered,
  FloppyDisk,
  Funnel,
  Play,
  SealCheck,
  ShareFat,
  ShieldCheck,
  Sparkle,
  Warning,
  Wrench,
  XCircle
} from "@phosphor-icons/react";
import { emptyBrief } from "@/lib/brief";
import { campaignProductionScope } from "@/lib/campaign-scope";
import { pipelineStageNames } from "@/lib/pipeline-stages";
import type { CampaignSummary } from "@/lib/campaign-store";
import { buildClientContentPack, type CampaignExportFormat } from "@/lib/exports";
import type {
  BriefInput,
  Claim,
  DeliveryPack,
  FactCategory,
  GenerationStage,
  PerformanceContext,
  PerformanceInput,
  PerformanceRecord,
  ProjectBrief
} from "@/lib/schemas";

type ViewName = "workbench" | "history" | "pipeline" | "results" | "performance" | "proof" | "exports";
type DiscoveredBrief = { brief: ProjectBrief; inferredFields: string[]; sourceCount: number; factCount?: number; factGaps?: string[] };
type VisualProgress = { total: number; rendered: number; failed: number };
type ResultsTab = "strategy" | "facts" | "landscape" | "audience" | "hooks" | "platform" | "lineage" | "calendar" | "content" | "visuals" | "proof" | "prompt-os" | "capacity";
type ProofFilter = "all" | "repaired" | Claim["status"];

const viewLabels: Record<ViewName, string> = {
  workbench: "Workbench",
  history: "History",
  pipeline: "Pipeline",
  results: "Results",
  performance: "Performance",
  proof: "Proof",
  exports: "Exports"
};

const resultsTabs: Array<{ id: ResultsTab; label: string }> = [
  { id: "strategy", label: "Strategy" },
  { id: "facts", label: "Fact Sheet" },
  { id: "landscape", label: "Landscape" },
  { id: "audience", label: "Audience" },
  { id: "hooks", label: "Hooks" },
  { id: "platform", label: "Platform Fit" },
  { id: "lineage", label: "Lineage" },
  { id: "calendar", label: "Calendar" },
  { id: "content", label: "Content Pack" },
  { id: "visuals", label: "Visuals" },
  { id: "proof", label: "Proof Report" },
  { id: "prompt-os", label: "Prompt OS" },
  { id: "capacity", label: "Capacity" }
];

const generationStageLabels: Array<{ id: GenerationStage["stage"]; label: string; note: string }> = [
  { id: "foundation", label: "Foundation", note: "Brand, strategy, landscape, audience, and territories" },
  { id: "architecture", label: "Architecture", note: "Hooks with a strategy review, core messages, series, and platform roles" },
  { id: "execution", label: "Execution", note: "Calendar and first-draft assets" },
  { id: "editorial", label: "Editorial", note: "Anti-slop rewrite, platform formats, and visual briefs" },
  { id: "governance", label: "Governance", note: "Claims, proof links, and production capacity" },
  { id: "verification", label: "Verification", note: "Captured source sections first, then web search for claims still unsupported" }
];
const proofFilters: Array<{ id: ProofFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "supported", label: "Supported" },
  { id: "unsupported", label: "Unsupported" },
  { id: "conflict", label: "Conflicts" },
  { id: "time-sensitive", label: "Time-Sensitive" },
  { id: "editorial", label: "Editorial" },
  { id: "repaired", label: "Repaired" }
];

function copyText(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(value);
  }
}

function platformClass(platform: string) {
  const key = platform.toLowerCase();
  if (key === "x") return "plat-pill plat-x";
  if (key === "linkedin") return "plat-pill plat-li";
  if (key === "newsletter") return "plat-pill plat-news";
  if (key === "discord") return "plat-pill plat-dis";
  if (key === "medium") return "plat-pill plat-med";
  if (key === "instagram") return "plat-pill plat-ig";
  if (key === "tiktok") return "plat-pill plat-tt";
  return "plat-pill plat-mir";
}

function statusMeta(status: Claim["status"]) {
  if (status === "supported") {
    return { className: "status-pill st-green", icon: <Check size={13} weight="bold" />, label: "Supported" };
  }
  if (status === "unsupported") {
    return { className: "status-pill st-amber", icon: <Warning size={13} weight="bold" />, label: "Unsupported" };
  }
  if (status === "conflict") {
    return { className: "status-pill st-red", icon: <XCircle size={13} weight="bold" />, label: "Conflict" };
  }
  if (status === "editorial") {
    return { className: "status-pill st-gray", icon: <FileText size={13} weight="bold" />, label: "Editorial" };
  }
  return { className: "status-pill st-blue", icon: <FlagCheckered size={13} weight="bold" />, label: "Time-Sensitive" };
}
function claimStatusMeta(claim: Claim) {
  if (claim.resolutionStatus === "repaired") {
    return { className: "status-pill st-green", icon: <Wrench size={13} weight="bold" />, label: "Repaired" };
  }
  return statusMeta(claim.status);
}
// The bar shows how much of the source was captured; credibility is shown separately as authority.
function sourceMeta(source: DeliveryPack["sources"][number]) {
  if (source.fetchStatus === "fetched" && source.completeness !== "truncated") {
    return { className: "badge bg-green", label: `${source.wordCount} words`, width: "100%" };
  }
  if (source.fetchStatus === "fetched") {
    return { className: "badge bg-amber", label: `${source.wordCount} words, partial`, width: "62%" };
  }
  if (source.fetchStatus === "failed") {
    return { className: "badge bg-amber", label: "fetch failed", width: "20%" };
  }
  return { className: "badge bg-gray", label: "not fetched", width: "8%" };
}


function websiteLabel(website: string) {
  return website.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").split("/")[0];
}

async function readGenerationStream(
  response: Response,
  onDiscovery: (discovered: DiscoveredBrief) => void,
  onStage: (stage: GenerationStage) => void,
  onVisuals: (progress: VisualProgress) => void
): Promise<{ pack: DeliveryPack; campaignId: string }> {
  let progress: VisualProgress = { total: 0, rendered: 0, failed: 0 };
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Generation stream was unavailable.");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = block.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event: "));
      const dataLine = lines.find((line) => line.startsWith("data: "));

      if (eventLine && dataLine) {
        const event = eventLine.slice(7);
        const payload = JSON.parse(dataLine.slice(6)) as unknown;

        if (event === "discovery") {
          onDiscovery(payload as DiscoveredBrief);
        } else if (event === "stage") {
          onStage(payload as GenerationStage);
        } else if (event === "visuals") {
          progress = { total: (payload as { total: number }).total, rendered: 0, failed: 0 };
          onVisuals(progress);
        } else if (event === "visual") {
          const status = (payload as { status: string }).status;
          progress = {
            ...progress,
            rendered: progress.rendered + (status === "generated" ? 1 : 0),
            failed: progress.failed + (status === "generated" ? 0 : 1)
          };
          onVisuals(progress);
        } else if (event === "complete") {
          return payload as { pack: DeliveryPack; campaignId: string };
        } else if (event === "error") {
          throw new Error((payload as { message?: string }).message ?? "Generation failed.");
        }
      }

      boundary = buffer.indexOf("\n\n");
    }
  }

  throw new Error("Generation stream ended before the delivery pack was ready.");
}

function PromptLineage({ pack, compact = false }: { pack: DeliveryPack; compact?: boolean }) {
  return (
    <section className={compact ? "prompt-lineage compact" : "prompt-lineage"}>
      <div className="prompt-lineage-header">
        <div>
          <span className="section-label">Prompt Lineage</span>
          <h3>Coded router selections</h3>
        </div>
        <span className={pack.promptLibrary.loaded ? "badge bg-green" : "badge bg-amber"}>
          {pack.promptLibrary.loaded ? `${pack.promptLibrary.totalPrompts} prompts loaded` : "Prompt library unavailable"}
        </span>
      </div>
      <div className="prompt-route-grid">
        {pack.promptRoutes.map((route) => (
          <article className="prompt-route-card" key={route.pipelineStage} title={route.reason}>
            <span>{route.pipelineStage}</span>
            <strong>{route.selectedPromptName}</strong>
            <div className="prompt-route-meta">
              <span>{route.libraryStage}</span>
              <span>score {route.matchScore}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function TopNav({
  view,
  setView,
  hasPack,
  loading
}: {
  view: ViewName;
  setView: (view: ViewName) => void;
  hasPack: boolean;
  loading: boolean;
}) {
  return (
    <header className="top-nav">
      <div className="nav-left">
        <div className="logo-box" aria-hidden="true" />
        <span>Flusso</span>
      </div>
      <nav className="view-switcher" aria-label="Primary views">
        {(Object.keys(viewLabels) as ViewName[]).map((item) => {
          const disabled = loading
            ? item !== "pipeline"
            : item === "pipeline" || (["results", "performance", "proof", "exports"].includes(item) && !hasPack);
          return (
            <button
              key={item}
              className={view === item ? "view-tab active" : "view-tab"}
              onClick={() => setView(item)}
              disabled={disabled}
            >
              {viewLabels[item]}
            </button>
          );
        })}
      </nav>
      <div className="nav-right">
        <div className="avatar">AK</div>
      </div>
    </header>
  );
}
function ProofSummary({ pack }: { pack: DeliveryPack }) {
  const { proofReport } = pack;
  const confidence = Math.round((proofReport.supported / proofReport.checkedClaims) * 100);

  return (
    <aside className="proof-rail">
      <div className="rail-header">Proof Layer</div>
      <div className="proof-score">
        <div>
          <span className="score-value">{confidence}%</span>
          <span className="score-label">confidence</span>
        </div>
        <ShieldCheck size={32} weight="duotone" />
      </div>
      <div className="metric-list">
        <div className="metric-row">
          <span>Claims checked</span>
          <strong>{proofReport.checkedClaims}</strong>
        </div>
        <div className="metric-row">
          <span>Supported</span>
          <strong className="green-text">{proofReport.supported}</strong>
        </div>
        <div className="metric-row">
          <span>Unsupported</span>
          <strong className="amber-text">{proofReport.unsupported}</strong>
        </div>
        <div className="metric-row">
          <span>Conflicts</span>
          <strong className="red-text">{proofReport.conflicts}</strong>
        </div>
      </div>
      <div className="divider" />
      {proofReport.claims
        .filter((claim) => claim.resolutionStatus === "unresolved" && claim.status !== "supported" && claim.status !== "editorial")
        .map((claim) => (
          <div key={claim.id} className="warning-card">
            <strong>{statusMeta(claim.status).label}</strong>
            <span>{claim.text}</span>
          </div>
        ))}
      <button className="btn btn-outline full" onClick={() => copyText(JSON.stringify(proofReport, null, 2))}>
        <Copy size={15} /> Copy proof JSON
      </button>
    </aside>
  );
}

function EmptyProofSummary() {
  return (
    <aside className="proof-rail empty-proof-rail">
      <div className="rail-header">Proof Layer</div>
      <div className="empty-rail-state">
        <ShieldCheck size={28} weight="duotone" />
        <strong>No proof report</strong>
        <span>Generate a campaign to populate claim verification.</span>
      </div>
    </aside>
  );
}

function Workbench({
  brief,
  setBrief,
  pack,
  onGenerate,
  loading,
  error
}: {
  brief: BriefInput;
  setBrief: (brief: BriefInput) => void;
  pack: DeliveryPack | null;
  onGenerate: () => void;
  loading: boolean;
  error: string | null;
}) {
  const update = <K extends keyof BriefInput>(key: K, value: BriefInput[K]) => setBrief({ ...brief, [key]: value });
  const platformOptions: BriefInput["platforms"] = ["X", "LinkedIn", "Instagram", "TikTok", "Newsletter", "Discord", "Mirror", "Medium"];
  const togglePlatform = (platform: BriefInput["platforms"][number]) => {
    const platforms = brief.platforms.includes(platform)
      ? brief.platforms.filter((item) => item !== platform)
      : [...brief.platforms, platform];
    update("platforms", platforms);
  };
  // Images render automatically, so say up front how many to expect.
  const { assetTarget } = campaignProductionScope(brief);
  const visualFirst = brief.platforms.some((platform) => platform === "Instagram" || platform === "TikTok");
  const imageEstimate = visualFirst ? "up to " + Math.min(16, assetTarget + 4) + " images" : "2 to 4 images";
  const canGenerate =
    websiteLabel(brief.website).includes(".") &&
    brief.goal.trim().length >= 5 &&
    brief.platforms.length > 0;

  return (
    <main className="main-content">
      <section className="sidebar">
        <div className="section-label">Project Intake</div>
        <label className="form-field">
          <span>Website</span>
          <input
            value={brief.website}
            onChange={(event) => update("website", event.target.value)}
            placeholder="example.com"
            inputMode="url"
            autoComplete="url"
            required
          />
        </label>
        <label className="form-field">
          <span>Campaign goal</span>
          <textarea value={brief.goal} onChange={(event) => update("goal", event.target.value)} placeholder="e.g. Build awareness and drive qualified product sign-ups" required />
        </label>
        <details className="optional-details">
          <summary>Optional details</summary>
          <p className="optional-hint">Leave these blank and Flusso infers the brand, industry, audience, tone, and competitors from the website.</p>
          <label className="form-field">
            <span>Brand name</span>
            <input value={brief.brand} onChange={(event) => update("brand", event.target.value)} placeholder="Inferred from the website" />
          </label>
          <label className="form-field">
            <span>Industry</span>
            <input value={brief.industry} onChange={(event) => update("industry", event.target.value)} placeholder="Inferred from the website" />
          </label>
          <label className="form-field">
            <span>Audience</span>
            <textarea value={brief.audience} onChange={(event) => update("audience", event.target.value)} placeholder="Inferred from the website" />
          </label>
          <label className="form-field">
            <span>Competitors</span>
            <textarea
              value={brief.competitors.join(", ")}
              onChange={(event) => update("competitors", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
              placeholder="Found by web search"
            />
          </label>
          <label className="form-field">
            <span>Tone</span>
            <input value={brief.tone} onChange={(event) => update("tone", event.target.value)} placeholder="Inferred from the website" />
          </label>
          <label className="form-field">
            <span>Docs URLs</span>
            <input value={brief.docs} onChange={(event) => update("docs", event.target.value)} placeholder="https://docs.example.com" />
          </label>
          <label className="form-field">
            <span>Editorial profile</span>
            <select
              value={brief.editorialProfile}
              onChange={(event) => update("editorialProfile", event.target.value as BriefInput["editorialProfile"])}
            >
              <option value="balanced">Balanced</option>
              <option value="technical-authority">Technical authority</option>
              <option value="founder-led">Founder-led</option>
              <option value="direct-growth">Direct growth</option>
            </select>
          </label>
          <div className="form-field">
            <span>Platforms</span>
            <div className="platform-options">
              {platformOptions.map((platform) => (
                <label key={platform} className="check-option">
                  <input
                    type="checkbox"
                    checked={brief.platforms.includes(platform)}
                    onChange={() => togglePlatform(platform)}
                  />
                  <span>{platform}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="field-grid">
            <label className="form-field">
              <span>Days</span>
              <input type="number" min={7} max={30} value={brief.durationDays} onChange={(event) => update("durationDays", Number(event.target.value))} placeholder="30" />
            </label>
            <label className="form-field">
              <span>Posts/wk</span>
              <input type="number" min={1} max={20} value={brief.postsPerWeek} onChange={(event) => update("postsPerWeek", Number(event.target.value))} placeholder="5" />
            </label>
          </div>
          <div className="field-grid">
            <label className="form-field">
              <span>Team size</span>
              <input type="number" min={1} max={20} value={brief.teamSize} onChange={(event) => update("teamSize", Number(event.target.value))} placeholder="1" />
            </label>
            <label className="form-field">
              <span>Team capacity</span>
              <input type="number" min={1} max={80} value={brief.hoursPerWeek} onChange={(event) => update("hoursPerWeek", Number(event.target.value))} placeholder="8" />
            </label>
          </div>
          <label className="form-field">
            <span>Restrictions</span>
            <textarea value={brief.restrictions} onChange={(event) => update("restrictions", event.target.value)} placeholder="e.g. Avoid pricing speculation and unverified performance claims" />
          </label>
        </details>
        <button className="btn btn-primary full" onClick={onGenerate} disabled={loading || !canGenerate}>
          {loading ? <Sparkle size={16} weight="duotone" /> : <Play size={16} weight="fill" />}
          {loading ? "Generating..." : "Generate Campaign Pack"}
        </button>
        <p className="muted">{assetTarget} posts and {imageEstimate} will be generated; each image is a paid image-model call.</p>
        {error ? <div className="error-box">{error}</div> : null}
      </section>

      <section className="workbench-center">
        <div className="workbench-header">
          <div>
            <h1>Evidence-backed campaign workbench</h1>
            <p>Add a website and a goal. Flusso reads the site and fills in the rest.</p>
          </div>
          <div className={pack ? "badge bg-green" : "badge bg-gray"}>
            {pack ? <SealCheck size={14} weight="fill" /> : null}
            {pack ? "Campaign generated" : "Awaiting intake"}
          </div>
        </div>
        <div className="pipeline-grid">
          {pipelineStageNames.map((stage, index) => (
            <div key={stage} className="pipeline-card">
              <div className="stage-index">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <strong>{stage}</strong>
                <span>{pack ? "Complete" : "Pending"}</span>
              </div>
            </div>
          ))}
        </div>
        {pack ? (
          <div className="artifact-grid">
            <div className="artifact-card wide">
              <div className="card-title">Current delivery pack</div>
              <p>{pack.brandContext.positioning}</p>
              <div className="chip-row">
                {pack.brandContext.voice.map((voice) => <span className="chip" key={voice}>{voice}</span>)}
              </div>
            </div>
            <div className="artifact-card">
              <div className="card-title">Audience segments</div>
              <strong>{pack.audienceSegments.length}</strong>
              <span>generated segments</span>
            </div>
            <div className="artifact-card">
              <div className="card-title">Calendar</div>
              <strong>{pack.calendar.length}</strong>
              <span>generated days</span>
            </div>
          </div>
        ) : (
          <div className="empty-workspace">
            <FileText size={30} weight="duotone" />
            <h2>No campaign generated</h2>
            <p>Results will appear here after the model returns a validated delivery pack.</p>
          </div>
        )}
      </section>

      {pack ? <ProofSummary pack={pack} /> : <EmptyProofSummary />}
    </main>
  );
}
function PipelineView({
  brief,
  discovered,
  stages,
  visuals
}: {
  brief: BriefInput;
  discovered: DiscoveredBrief | null;
  stages: GenerationStage[];
  visuals: VisualProgress | null;
}) {
  const activeStage = discovered ? generationStageLabels[stages.length] : null;
  const summary = discovered?.brief ?? brief;
  const projectName = summary.brand || websiteLabel(brief.website);

  return (
    <main className="main-layout" aria-busy="true">
      <aside className="col-left">
        <div className="section-label">Project Summary</div>
        <h2>{projectName} Campaign</h2>
        <div className="kv-row"><span>Goal</span><strong>{summary.goal}</strong></div>
        {discovered ? <div className="kv-row"><span>Industry</span><strong>{discovered.brief.industry}</strong></div> : null}
        {discovered ? <div className="kv-row"><span>Audience</span><strong>{discovered.brief.audience}</strong></div> : null}
        <div className="kv-row"><span>Duration</span><strong>{summary.durationDays} days</strong></div>
        <div className="kv-row"><span>Capacity</span><strong>{summary.hoursPerWeek} hrs/wk</strong></div>
        {discovered?.inferredFields.length ? (
          <div className="kv-row"><span>Inferred</span><strong>{discovered.inferredFields.join(", ")}</strong></div>
        ) : null}
      </aside>
      <section className="col-center">
        <div className="live-line"><span className="live-dot" /> Live generation stream</div>
        <h1>Generating campaign pack</h1>
        <p className="subcopy">Each structured stage validates before the next one begins.</p>
        <div className="pipeline">
          <div className={discovered ? "stage-card complete" : "stage-card running"}>
            <div className="stage-circle">{discovered ? <Check size={13} weight="bold" /> : null}</div>
            <span className="st-num">00</span>
            <div className="st-name-wrap">
              <div className="st-name">Discovery</div>
              <div className="st-note">
                {discovered
                  ? discovered.sourceCount + " sources read" +
                    (discovered.factCount === undefined ? "" : ", " + discovered.factCount + " facts verified") +
                    (discovered.factGaps?.length ? "; no evidence for " + discovered.factGaps.join(", ") : "")
                  : "Reading the website, verifying facts, and filling gaps"}
              </div>
            </div>
            <div className="st-meta">
              <span className="badge bg-green">{discovered ? "done" : "running"}</span>
            </div>
          </div>
          {generationStageLabels.map((stage, index) => {
            const completed = stages.find((item) => item.stage === stage.id);
            const running = Boolean(discovered) && !completed && index === stages.length;
            const className = completed ? "stage-card complete" : running ? "stage-card running" : "stage-card queued";

            return (
              <div className={className} key={stage.id}>
                <div className="stage-circle">{completed ? <Check size={13} weight="bold" /> : null}</div>
                <span className="st-num">{String(index + 1).padStart(2, "0")}</span>
                <div className="st-name-wrap">
                  <div className="st-name">{stage.label}</div>
                  <div className="st-note">{stage.note}</div>
                </div>
                <div className="st-meta">
                  <span className={completed || running ? "badge bg-green" : "pill pill-gray"}>
                    {completed ? (completed.durationMs / 1000).toFixed(1) + "s" : running ? "running" : "queued"}
                  </span>
                </div>
              </div>
            );
          })}
          <div className={visuals && visuals.rendered + visuals.failed >= visuals.total ? "stage-card complete" : visuals ? "stage-card running" : "stage-card queued"}>
            <div className="stage-circle">{visuals && visuals.rendered + visuals.failed >= visuals.total ? <Check size={13} weight="bold" /> : null}</div>
            <span className="st-num">{String(generationStageLabels.length + 1).padStart(2, "0")}</span>
            <div className="st-name-wrap">
              <div className="st-name">Images</div>
              <div className="st-note">
                {visuals
                  ? visuals.rendered + " of " + visuals.total + " rendered" + (visuals.failed ? ", " + visuals.failed + " not rendered" : "")
                  : "Renders each planned visual in the brand palette"}
              </div>
            </div>
            <div className="st-meta">
              <span className={visuals ? "badge bg-green" : "pill pill-gray"}>{visuals ? (visuals.rendered + visuals.failed >= visuals.total ? "done" : "running") : "queued"}</span>
            </div>
          </div>
        </div>
      </section>
      <aside className="col-right">
        <div className="section-label">Generation Status</div>
        <div className="empty-rail-state pipeline-waiting">
          <Sparkle size={28} weight="duotone" />
          <strong>
            {!discovered ? "Discovery in progress" : activeStage ? activeStage.label + " in progress" : "Finalizing delivery pack"}
          </strong>
          <span>{stages.length} of {generationStageLabels.length} stages complete</span>
        </div>
      </aside>
    </main>
  );
}
function ResultsView({
  pack,
  campaignId,
  onPackChange
}: {
  pack: DeliveryPack;
  campaignId: string | null;
  onPackChange: (pack: DeliveryPack) => void;
}) {
  const [tab, setTab] = useState<ResultsTab>("calendar");
  return (
    <main className="page-view">
      <div className="page-header">
        <div>
          <h1>{pack.brief.brand} Campaign</h1>
          <p>{pack.brief.goal} {pack.brief.durationDays} days. {pack.brief.platforms.length} platforms.</p>
          <div className="tags-row">
            <span className="pill-green"><SealCheck size={13} weight="fill" /> Proof Checked</span>
            <span className={pack.generation.mode === "llm" ? "pill-green" : "pill-gray"}>
              {`AI · ${pack.generation.model}`}
            </span>
            <span className="pill-gray">{pack.proofReport.checkedClaims} claims</span>
            <span className="pill-gray">{pack.sources.length} sources</span>
            {pack.generationStages.length ? <span className="pill-gray">{pack.generationStages.length} stages</span> : null}
          </div>
        </div>
        <div className="btn-group">
          <button className="btn btn-outline" onClick={() => copyText(JSON.stringify(buildClientContentPack(pack), null, 2))}><DownloadSimple size={15} /> JSON</button>
          <button className="btn btn-outline" onClick={() => copyText(pack.assets.map((asset) => asset.copy).join("\n\n"))}><Copy size={15} /> Copy</button>
          <button className="btn btn-outline"><ShareFat size={15} /> Share</button>
        </div>
      </div>
      <div className="tab-bar">
        {resultsTabs.map((item) => (
          <button key={item.id} className={tab === item.id ? "tab active" : "tab"} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="main-area">
        <section className="content-area">
          {tab === "strategy" ? <StrategyTab pack={pack} /> : null}
          {tab === "facts" ? <FactsTab pack={pack} campaignId={campaignId} /> : null}
          {tab === "landscape" ? <LandscapeTab pack={pack} /> : null}
          {tab === "audience" ? <AudienceTab pack={pack} /> : null}
          {tab === "hooks" ? <HooksTab pack={pack} /> : null}
          {tab === "platform" ? <PlatformFitTab pack={pack} /> : null}
          {tab === "lineage" ? <LineageTab pack={pack} /> : null}
          {tab === "calendar" ? <CalendarTab pack={pack} /> : null}
          {tab === "content" ? <ContentTab pack={pack} /> : null}
          {tab === "visuals" ? <VisualsTab pack={pack} campaignId={campaignId} onPackChange={onPackChange} /> : null}
          {tab === "proof" ? <ProofMiniTab pack={pack} /> : null}
          {tab === "prompt-os" ? <PromptOSTab pack={pack} /> : null}
          {tab === "capacity" ? <CapacityTab pack={pack} /> : null}
        </section>
        <aside className="right-rail">
          <div className="rail-header">Sources</div>
          {pack.sources.map((source) => {
            const meta = sourceMeta(source);
            return (
              <div className="source-card" key={source.id} title={source.failureReason ?? source.url ?? source.title}>
                <div className="src-title">{source.title}</div>
                <div className="src-domain">{source.sourceType}</div>
                <span className={meta.className}>{source.authority} / {meta.label}</span>
                <div className="conf-bar"><div className="conf-fill" style={{ width: meta.width }} /></div>
                <div className="src-date">{new Date(source.fetchedAt).toLocaleDateString()}</div>
              </div>
            );
          })}
        </aside>
      </div>
    </main>
  );
}


function LandscapeTab({ pack }: { pack: DeliveryPack }) {
  const { contentLandscape } = pack;
  const allGaps = [
    ...contentLandscape.opportunityGaps,
    ...contentLandscape.formatGaps,
    ...contentLandscape.toneGaps
  ];

  return (
    <div>
      <div className="section-title">Content Landscape</div>
      <div className="panel">
        <p>{contentLandscape.summary || "Landscape analysis will appear after the next generation."}</p>
        <div className="divider" />
        <div className="grid-2-responsive">
          <div>
            <h3>Competitor patterns</h3>
            <ul className="clean-list">{contentLandscape.competitorPatterns.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div>
            <h3>Saturated narratives</h3>
            <ul className="clean-list warning-list">{contentLandscape.saturatedNarratives.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
      </div>
      <div className="section-title">Opportunity Map</div>
      <div className="territory-grid">
        {allGaps.map((gap) => (
          <article className="territory-card" key={gap.id}>
            <div className="card-topline"><span className="format-badge">{gap.type}</span><span>{gap.priority}</span></div>
            <h3>{gap.name}</h3>
            <p>{gap.evidence}</p>
            <div className="mini-heading">Recommendation</div>
            <p>{gap.recommendation}</p>
          </article>
        ))}
      </div>
      <div className="section-title">Platform Insights</div>
      <table>
        <thead><tr><th>Platform</th><th>Insight</th><th>Opportunity</th></tr></thead>
        <tbody>
          {contentLandscape.platformInsights.map((item) => (
            <tr key={`${item.platform}-${item.insight}`}><td><span className={platformClass(item.platform)}>{item.platform}</span></td><td>{item.insight}</td><td>{item.opportunity}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlatformFitTab({ pack }: { pack: DeliveryPack }) {
  const hookById = new Map(pack.hooks.map((hook) => [hook.id, hook]));

  return (
    <div className="territory-grid">
      {pack.platformAdaptations.map((adaptation) => (
        <article className="territory-card" key={adaptation.platform}>
          <div className="card-topline"><span className={platformClass(adaptation.platform)}>{adaptation.platform}</span><span>{adaptation.role}</span></div>
          <h3>{adaptation.ctaStyle}</h3>
          <p>{adaptation.reasoning}</p>
          <div className="mini-heading">Strongest hooks</div>
          <ul className="clean-list">
            {adaptation.strongestHookIds.map((hookId) => <li key={hookId}>{hookById.get(hookId)?.text ?? hookId}</li>)}
          </ul>
          <div className="chip-row">{adaptation.formatPairings.map((pairing) => <span className="chip" key={pairing}>{pairing}</span>)}</div>
        </article>
      ))}
    </div>
  );
}

function LineageTab({ pack }: { pack: DeliveryPack }) {
  const seriesById = new Map(pack.contentSeries.map((series) => [series.id, series]));
  const hookById = new Map(pack.hooks.map((hook) => [hook.id, hook]));

  return (
    <div className="calendar-list">
      {pack.calendar.slice(0, 30).map((item) => {
        const series = seriesById.get(item.series);
        const hook = hookById.get(item.hookId);
        return (
          <article className="calendar-row" key={item.id}>
            <div className="calendar-day"><span>Day</span><strong>{item.day}</strong></div>
            <div className="calendar-body">
              <div className="calendar-meta">
                <span className={platformClass(item.platform)}>{item.platform}</span>
                <span className="format-badge">{item.format}</span>
                <span className="goal-pill goal-aw">{item.goal}</span>
              </div>
              <p className="calendar-hook">{item.hook}</p>
              <div className="calendar-support">
                <span><strong>Segment</strong> {item.audienceSegment}</span>
                <span><strong>Territory</strong> {item.territory || "Unmapped"}</span>
                <span><strong>Series</strong> {series?.title ?? (item.series || "Standalone")}</span>
                <span><strong>Episode</strong> {item.episode || "None"}</span>
                <span><strong>Hook ID</strong> {hook?.id ?? (item.hookId || "Unmapped")}</span>
                <span><strong>Source pack</strong> {item.sourcePack.length} sources</span>
              </div>
              {item.platformFitReason ? <p>{item.platformFitReason}</p> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}


function PromptOSTab({ pack }: { pack: DeliveryPack }) {
  const stages = Array.from(new Set(pack.promptModules.map((module) => module.libraryStage)));

  if (!pack.promptModules.length) {
    return (
      <div className="panel">
        <div className="section-title">Prompt OS</div>
        <p>Prompt module metadata will appear on newly generated campaigns.</p>
        <PromptLineage pack={pack} compact />
      </div>
    );
  }

  return (
    <div className="proof-tab-stack">
      <PromptLineage pack={pack} compact />
      {pack.generationStages.length ? (
        <section>
          <div className="section-title">Generation Stages <span>{pack.generationStages.length} completed</span></div>
          <div className="territory-grid">
            {pack.generationStages.map((stage, index) => (
              <article className="territory-card" key={stage.stage}>
                <div className="card-topline">
                  <span className="badge bg-green">{String(index + 1).padStart(2, "0")} complete</span>
                  <span>{(stage.durationMs / 1000).toFixed(1)}s</span>
                </div>
                <h3>{stage.label}</h3>
                <div className="chip-row">
                  {stage.outputKeys.map((outputKey) => <span className="chip" key={outputKey}>{outputKey}</span>)}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {stages.map((stage) => (
        <section key={stage}>
          <div className="section-title">{stage} Modules</div>
          <div className="territory-grid">
            {pack.promptModules.filter((module) => module.libraryStage === stage).map((module) => (
              <article className="territory-card" key={module.id}>
                <div className="card-topline">
                  <span className={module.usedInMvp ? "badge bg-green" : "badge bg-gray"}>{module.usedInMvp ? "MVP" : "Later"}</span>
                  <span>{module.outputArtifact}</span>
                </div>
                <h3>{module.name}</h3>
                <p>{module.capability}</p>
                <div className="mini-heading">Depends on</div>
                <div className="chip-row">{module.dependsOn.map((dependency) => <span className="chip" key={dependency}>{dependency}</span>)}</div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
function CapacityTab({ pack }: { pack: DeliveryPack }) {
  return (
    <div className="proof-tab-stack">
      <div className="panel">
        <div className="section-title">Capacity Check <span>{pack.productionPlan.overloadRisk} risk</span></div>
        <p>{pack.productionPlan.capacitySummary || `Planned workload: ${pack.productionPlan.totalHours}`}</p>
        {pack.productionPlan.warnings.length ? (
          <ul className="clean-list warning-list">{pack.productionPlan.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
        ) : null}
      </div>
      <div className="territory-grid">
        {pack.productionPlan.roleAssignments.map((assignment) => (
          <article className="territory-card" key={assignment.role}>
            <div className="card-topline"><span>{assignment.ownerCount} owner(s)</span><span>{assignment.hours}</span></div>
            <h3>{assignment.role}</h3>
            <ul className="clean-list">{assignment.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul>
          </article>
        ))}
      </div>
      <ProductionTab pack={pack} />
    </div>
  );
}

function CampaignStrategyPanel({ pack }: { pack: DeliveryPack }) {
  const { strategy } = pack;
  if (!strategy) return null;
  const priority = pack.audienceSegments.find((segment) => segment.id === strategy.prioritySegmentId);
  return (
    <>
      <div className="section-title">Campaign Strategy</div>
      <div className="panel">
        <p className="strategy-statement">{strategy.statement}</p>
        <div className="kv-row"><span>Priority segment</span><strong>{priority?.name ?? "Not resolved"}</strong></div>
        <div className="kv-row"><span>Audience need</span><strong>{strategy.audienceNeed}</strong></div>
        {strategy.outOfScope.length ? (
          <>
            <div className="mini-heading">Out of scope</div>
            <ul className="clean-list warning-list">{strategy.outOfScope.map((item) => <li key={item}>{item}</li>)}</ul>
          </>
        ) : null}
        <div className="mini-heading">Success criteria</div>
        <p className="muted">Target ranges are proposals to agree with the client, not forecasts.</p>
        <table>
          <thead><tr><th>Outcome</th><th>Metric</th><th>Target range</th><th>Baseline</th><th>Measurement</th></tr></thead>
          <tbody>
            {strategy.successCriteria.map((criterion) => (
              <tr key={criterion.outcome + criterion.metric}>
                <td>{criterion.outcome}</td>
                <td>{criterion.metric}</td>
                <td>{criterion.targetRange}</td>
                <td>{criterion.baseline}</td>
                <td>{criterion.measurement}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StrategyTab({ pack }: { pack: DeliveryPack }) {
  const assumptions = pack.brandContext.assumptions ?? [];
  return (
    <div>
      <CampaignStrategyPanel pack={pack} />
      <div className="section-title">Strategic Positioning</div>
      <div className="panel">
        <p>{pack.brandContext.positioning}</p>
        <div className="divider" />
        <div className="grid-2-responsive">
          <div>
            <h3>Content goals</h3>
            <ul className="clean-list">{pack.brandContext.contentGoals.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <div>
            <h3>Prohibited claims</h3>
            <ul className="clean-list warning-list">{pack.brandContext.prohibitedClaims.map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
        </div>
        {assumptions.length ? (
          <>
            <div className="divider" />
            <h3>Assumptions to confirm with the brand</h3>
            <ul className="clean-list warning-list">{assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
          </>
        ) : null}
      </div>
      <div className="section-title">Content Territories</div>
      <div className="territory-grid">
        {pack.territories.map((territory) => (
          <article className="territory-card" key={territory.name}>
            <h3>{territory.name}</h3>
            <p>{territory.rationale}</p>
            <div className="chip-row">{territory.sampleAngles.map((angle) => <span className="chip" key={angle}>{angle}</span>)}</div>
          </article>
        ))}
      </div>
    </div>
  );
}

const factCategories: Array<{ id: FactCategory; label: string }> = [
  { id: "product", label: "Product" },
  { id: "audience", label: "Audience" },
  { id: "proof", label: "Proof" },
  { id: "pricing", label: "Pricing" },
  { id: "competitor", label: "Competitors or peer organizations" },
  { id: "company", label: "Company" }
];

type SectionSearchResult = { sectionId: string; sourceId: string; heading: string; snippet: string; rank: number };

// Search snippets mark matches with « and »; render them as highlights without injecting HTML.
function HighlightedSnippet({ text }: { text: string }) {
  return (
    <>
      {text.split(/«([^»]*)»/).map((part, index) => (index % 2 ? <mark key={index}>{part}</mark> : part))}
    </>
  );
}

function SectionSearch({ campaignId, pack }: { campaignId: string; pack: DeliveryPack }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SectionSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const sourceTitle = (sourceId: string) => pack.sources.find((source) => source.id === sourceId)?.title ?? sourceId;

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const response = await fetch("/api/campaigns/" + campaignId + "/sections?q=" + encodeURIComponent(query.trim()));
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Search failed.");
      setResults(payload.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <>
      <div className="section-title">Search the sources</div>
      <form className="section-search" onSubmit={search}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find the passage behind a claim, e.g. buyout price"
          aria-label="Search source sections"
        />
        <button className="btn btn-outline" type="submit" disabled={searching || query.trim().length < 2}>
          {searching ? "Searching..." : "Search"}
        </button>
      </form>
      {error ? <div className="error-box">{error}</div> : null}
      {results ? (
        results.length ? (
          <div className="search-results">
            {results.map((result) => (
              <article className="search-result" key={result.sectionId}>
                <div className="search-result-title">
                  <strong>{sourceTitle(result.sourceId)}{result.heading ? " / " + result.heading : ""}</strong>
                  <code>{result.sectionId}</code>
                </div>
                <p><HighlightedSnippet text={result.snippet} /></p>
              </article>
            ))}
          </div>
        ) : <p className="muted">No passage matches that search.</p>
      ) : null}
    </>
  );
}

function FactsTab({ pack, campaignId }: { pack: DeliveryPack; campaignId: string | null }) {
  const { factSheet } = pack;
  const sourceById = new Map(pack.sources.map((source) => [source.id, source]));
  return (
    <div>
      {factSheet.gaps.length ? (
        <div className="warning-card">
          <strong><Warning size={14} /> No verified evidence for {factSheet.gaps.join(", ")}</strong>
          <span>Discovery looked and found nothing it could quote. Supply a source before making claims about these.</span>
        </div>
      ) : null}
      {!factSheet.facts.length ? <p className="muted">This campaign was generated before fact sheets were added.</p> : null}
      {factCategories.map((category) => {
        const facts = factSheet.facts.filter((fact) => fact.category === category.id);
        if (!facts.length) return null;
        return (
          <section key={category.id}>
            <div className="section-title">{category.label} <span className="pill-gray">{facts.length}</span></div>
            <div className="fact-list">
              {facts.map((fact) => {
                const source = sourceById.get(fact.sourceId);
                return (
                  <article className="fact-card" key={fact.id}>
                    <p className="fact-statement">{fact.statement}</p>
                    <blockquote className="evidence-quote">{fact.quote}</blockquote>
                    <div className="chip-row">
                      {source?.url ? <a className="chip" href={source.url} target="_blank" rel="noreferrer">{source.title}</a> : <span className="chip">{source?.title ?? fact.sourceId}</span>}
                      <span className="chip">{fact.authority}</span>
                      {fact.entity ? <span className="chip">{fact.entity}</span> : null}
                      {fact.timeSensitive ? <span className="chip chip-amber">time-sensitive</span> : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {factSheet.discoverySteps.length ? (
        <>
          <div className="section-title">Follow-up research</div>
          <table>
            <thead><tr><th>Why</th><th>How</th><th>Target</th><th>Outcome</th></tr></thead>
            <tbody>
              {factSheet.discoverySteps.map((step) => (
                <tr key={step.reason + step.target}>
                  <td>{step.reason}</td>
                  <td>{step.method}</td>
                  <td className="wrap-anywhere">{step.target}</td>
                  <td>{step.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {factSheet.excludedCompetitors.length ? (
        <p className="muted">
          Not counted as competitors: {factSheet.excludedCompetitors.map((item) => item.entity).join(", ")}. The brand&apos;s own pages name them, so they are likely a parent, partner, or integration.
        </p>
      ) : null}
      {factSheet.rejectedFacts || factSheet.extractionErrors.length ? (
        <p className="muted">
          {factSheet.rejectedFacts} proposed facts were dropped because their quotes were not found in the source.
          {factSheet.extractionErrors.length ? " " + factSheet.extractionErrors.length + " sources could not be read for facts." : ""}
        </p>
      ) : null}
      {campaignId ? <SectionSearch campaignId={campaignId} pack={pack} /> : null}
    </div>
  );
}

function AudienceTab({ pack }: { pack: DeliveryPack }) {
  return (
    <div className="territory-grid">
      {pack.audienceSegments.map((segment) => (
        <article className="territory-card" key={segment.name}>
          <div className="card-topline">
            <span>{segment.awarenessLevel}</span>
            {segment.primaryPlatform ? <span className={platformClass(segment.primaryPlatform)}>{segment.primaryPlatform}</span> : null}
          </div>
          <h3>{segment.name}</h3>
          <p>{segment.messagePositioning || segment.awarenessLevel}</p>
          <div className="mini-heading">Needs</div>
          <ul className="clean-list">{segment.needs.map((need) => <li key={need}>{need}</li>)}</ul>
          {segment.proofPoints.length ? <><div className="mini-heading">Proof points</div><ul className="clean-list">{segment.proofPoints.map((point) => <li key={point}>{point}</li>)}</ul></> : null}
          {segment.tabooTopics.length ? <><div className="mini-heading">Avoid</div><ul className="clean-list warning-list">{segment.tabooTopics.map((topic) => <li key={topic}>{topic}</li>)}</ul></> : null}
          <div className="chip-row">{segment.formatPreferences.map((format) => <span className="chip" key={format}>{format}</span>)}</div>
          <div className="mini-heading">CTA</div>
          <span className="goal-pill goal-rt">{segment.cta}</span>
        </article>
      ))}
    </div>
  );
}

function strategyFitLabel(score: number) {
  return score ? score + "/5" : "Not reviewed";
}

function HooksTab({ pack }: { pack: DeliveryPack }) {
  return (
    <div>
      <table>
        <thead><tr><th>Hook</th><th>Strategy fit</th><th>Trigger</th><th>Platform</th><th>Territory</th><th>Format Pairing</th><th>Test</th></tr></thead>
        <tbody>
          {pack.hooks.map((hook) => (
            <tr key={hook.id}>
              <td>{hook.text}</td>
              <td title={hook.strategyFitReason}>{strategyFitLabel(hook.strategyFit)}</td>
              <td>{hook.triggerType}</td>
              <td><span className={platformClass(hook.platform)}>{hook.platform}</span></td>
              <td>{hook.contentTerritory || hook.audienceSegment}</td>
              <td>{hook.formatPairing}</td>
              <td>{hook.testHypothesis || hook.goal}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {pack.droppedHooks.length ? (
        <>
          <div className="section-title">Dropped by the strategy review</div>
          <table className="muted-table">
            <thead><tr><th>Hook</th><th>Strategy fit</th><th>Why it was dropped</th></tr></thead>
            <tbody>
              {pack.droppedHooks.map((hook) => (
                <tr key={hook.id + hook.text}>
                  <td>{hook.text}</td>
                  <td>{strategyFitLabel(hook.strategyFit)}</td>
                  <td>{hook.strategyFitReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}

function CalendarTab({ pack }: { pack: DeliveryPack }) {
  return (
    <div className="calendar-list">
      {pack.calendar.slice(0, 30).map((item) => (
        <article className="calendar-row" key={item.id}>
          <div className="calendar-day">
            <span>Day</span>
            <strong>{item.day}</strong>
          </div>
          <div className="calendar-body">
            <div className="calendar-meta">
              <span className={platformClass(item.platform)}>{item.platform}</span>
              <span className="format-badge">{item.format}</span>
              <span className="goal-pill goal-aw">{item.goal}</span>
            </div>
            <p className="calendar-hook">{item.hook}</p>
            <div className="calendar-support">
              <span><strong>Audience</strong> {item.audienceSegment}</span>
              <span><strong>Territory</strong> {item.territory || "Unmapped"}</span>
              <span><strong>Series</strong> {item.series || "Standalone"}</span>
              <span><strong>CTA</strong> {item.cta || "Open loop"}</span>
              <span><strong>Source pack</strong> {item.sourcePack.length} sources</span>
            </div>
            {item.platformFitReason ? <p>{item.platformFitReason}</p> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function assetBodyText(asset: DeliveryPack["assets"][number]) {
  if (asset.contentFormat === "thread" && asset.threadPosts.length) {
    return asset.threadPosts.map((post, index) => `${index + 1}. ${post}`).join("\n\n");
  }
  if (asset.article) {
    return [
      asset.title,
      asset.article.subtitle,
      asset.article.introduction,
      ...asset.article.sections.flatMap((section) => [section.heading, section.body]),
      asset.article.conclusion,
      asset.article.tags.join(", ")
    ].filter(Boolean).join("\n\n");
  }
  if (asset.contentFormat === "carousel" && asset.slides.length) {
    const slides = asset.slides.map((slide, index) => `Slide ${index + 1}: ${slide.headline}\n${slide.body}`);
    return [...slides, "Caption:\n" + asset.copy].join("\n\n");
  }
  if (asset.videoScript) {
    const beats = asset.videoScript.beats.map(
      (beat, index) => `${index + 1}. Visual: ${beat.visual}\nVoiceover: ${beat.voiceover}\nOn screen: ${beat.onScreenText}`
    );
    return ["Hook: " + asset.videoScript.hook, ...beats, "Caption:\n" + asset.copy].join("\n\n");
  }
  return asset.copy;
}

// Groups renditions under the core message they carry; assets without one are listed last.
function ContentTab({ pack }: { pack: DeliveryPack }) {
  if (!pack.contentItems.length) return <AssetGrid assets={pack.assets} />;
  const itemIds = new Set(pack.contentItems.map((item) => item.id));
  const unassigned = pack.assets.filter((asset) => !itemIds.has(asset.contentItemId));
  return (
    <div>
      {pack.contentItems.map((item) => {
        const renditions = pack.assets.filter((asset) => asset.contentItemId === item.id);
        return (
          <section className="content-item-group" key={item.id}>
            <div className="core-message">
              <span className="mini-heading">Core message</span>
              <p>{item.coreMessage}</p>
              <span className="muted">
                {renditions.length} rendition{renditions.length === 1 ? "" : "s"} · {item.factIds.length} supporting fact{item.factIds.length === 1 ? "" : "s"}
              </span>
            </div>
            {renditions.length ? <AssetGrid assets={renditions} /> : <p className="muted">No asset was drafted for this message.</p>}
          </section>
        );
      })}
      {unassigned.length ? (
        <section className="content-item-group">
          <div className="core-message"><span className="mini-heading">Not linked to a core message</span></div>
          <AssetGrid assets={unassigned} />
        </section>
      ) : null}
    </div>
  );
}

function AssetGrid({ assets }: { assets: DeliveryPack["assets"] }) {
  return (
    <div className="content-card-grid">
      {assets.map((asset) => (
        <article className="content-card" key={asset.id}>
          <div className="card-topline">
            <span className={platformClass(asset.platform)}>{asset.platform}</span>
            <span className="format-badge">{asset.contentFormat}</span>
            <span>{asset.editorialMode}</span>
          </div>
          <h3>{asset.title}</h3>
          {asset.contentFormat === "thread" && asset.threadPosts.length ? (
            <ol className="thread-posts">
              {asset.threadPosts.map((post, index) => <li key={`${asset.id}-${index}`}>{post}</li>)}
            </ol>
          ) : asset.article ? (
            <div className="article-preview">
              <strong>{asset.article.subtitle}</strong>
              <p>{asset.article.introduction}</p>
              {asset.article.sections.map((section) => (
                <section key={section.heading}>
                  <h4>{section.heading}</h4>
                  <p>{section.body}</p>
                </section>
              ))}
              <p>{asset.article.conclusion}</p>
            </div>
          ) : asset.contentFormat === "carousel" && asset.slides.length ? (
            <div className="article-preview">
              <ol className="thread-posts">
                {asset.slides.map((slide, index) => (
                  <li key={`${asset.id}-slide-${index}`}><strong>{slide.headline}</strong> {slide.body}</li>
                ))}
              </ol>
              <div className="mini-heading">Caption</div>
              <p className="caption-text">{asset.copy}</p>
            </div>
          ) : asset.videoScript ? (
            <div className="article-preview">
              <p><strong>Hook:</strong> {asset.videoScript.hook}</p>
              <ol className="thread-posts">
                {asset.videoScript.beats.map((beat, index) => (
                  <li key={`${asset.id}-beat-${index}`}>
                    <strong>{beat.onScreenText || "Beat " + (index + 1)}</strong> {beat.voiceover}
                    <span className="muted"> ({beat.visual})</span>
                  </li>
                ))}
              </ol>
              <p className="muted">{asset.videoScript.durationSeconds} seconds · {asset.videoScript.audioNote}</p>
              <div className="mini-heading">Caption</div>
              <p className="caption-text">{asset.copy}</p>
            </div>
          ) : (
            <p className="caption-text">{asset.copy}</p>
          )}
          <div className="chip-row">
            {asset.segment ? <span className="chip">{asset.segment}</span> : null}
            {asset.territory ? <span className="chip">{asset.territory}</span> : null}
            {asset.visualBriefId ? <span className="chip">visual planned</span> : null}
          </div>
          <div className="content-footer">
            <span>{asset.linkedClaims.length} claims</span>
            <button className="icon-btn" onClick={() => copyText(assetBodyText(asset))} aria-label={`Copy ${asset.title}`}>
              <Copy size={15} />
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function BrandIdentityPanel({ identity }: { identity: DeliveryPack["brandIdentity"] }) {
  if (!identity) return null;

  return (
    <section className="panel brand-identity" aria-label="Brand identity">
      <div className="brand-identity-header">
        <div>
          <span className="section-label">Brand identity</span>
          <p>Extracted from {websiteLabel(identity.sourceUrl)}. Visual briefs and generated images use this palette.</p>
        </div>
        {identity.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external logo hosted on the brand's own site
          <img className="brand-logo" src={identity.logoUrl} alt="Brand logo" referrerPolicy="no-referrer" />
        ) : null}
      </div>
      {identity.colors.length ? (
        <div className="swatch-row">
          {identity.colors.map((color) => (
            <div className="swatch" key={color.role}>
              <span className="swatch-chip" style={{ background: color.value }} />
              <strong>{color.value}</strong>
              <span>{color.role}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="calendar-support">
        {identity.headingFont ? <span><strong>Headings</strong> {identity.headingFont}</span> : null}
        {identity.bodyFont ? <span><strong>Body</strong> {identity.bodyFont}</span> : null}
        {identity.colorScheme ? <span><strong>Scheme</strong> {identity.colorScheme}</span> : null}
        {identity.personality ? <span><strong>Personality</strong> {identity.personality}</span> : null}
      </div>
    </section>
  );
}

function VisualsTab({
  pack,
  campaignId,
  onPackChange
}: {
  pack: DeliveryPack;
  campaignId: string | null;
  onPackChange: (pack: DeliveryPack) => void;
}) {
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  async function generateVisual(visualId: string) {
    if (!campaignId) {
      setError("Save or reopen this campaign before generating visuals.");
      return;
    }
    setGeneratingId(visualId);
    setError(null);
    try {
      const response = await fetch(
        `/api/campaigns/${encodeURIComponent(campaignId)}/visuals/${encodeURIComponent(visualId)}`,
        { method: "POST" }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to generate visual.");
      onPackChange(payload.pack as DeliveryPack);
      setRevision((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate visual.");
    } finally {
      setGeneratingId(null);
    }
  }

  if (!pack.visualBriefs.length) {
    return (
      <div className="visuals-stack">
        <BrandIdentityPanel identity={pack.brandIdentity} />
        <div className="performance-empty">No visual briefs were generated for this campaign.</div>
      </div>
    );
  }

  return (
    <div className="visuals-stack">
      <BrandIdentityPanel identity={pack.brandIdentity} />
      {error ? <div className="error-box">{error}</div> : null}
      <div className="visual-grid">
        {pack.visualBriefs.map((brief) => {
          const generated = brief.status === "generated" && campaignId;
          return (
            <article className="visual-card" key={brief.id}>
              <div className={`visual-frame ratio-${brief.aspectRatio.replace(":", "-")}`}>
                {generated ? (
                  <Image
                    src={`/api/campaigns/${encodeURIComponent(campaignId)}/visuals/${encodeURIComponent(brief.id)}?v=${revision}`}
                    alt={brief.altText}
                    fill
                    unoptimized
                    sizes="(max-width: 900px) 100vw, 50vw"
                  />
                ) : (
                  <div className="visual-placeholder"><Sparkle size={24} /><span>{brief.visualType}</span></div>
                )}
              </div>
              <div className="visual-card-body">
                <div className="card-topline"><span className="format-badge">{brief.aspectRatio}</span><span>{brief.status}</span></div>
                <h3>{brief.keyMessage}</h3>
                <p>{brief.purpose}</p>
                {brief.statusNote ? <p className="amber-text">{brief.statusNote}</p> : null}
                <div className="visual-actions">
                  <span>{brief.sourceIds.length} sources</span>
                  <button
                    className="btn btn-primary"
                    onClick={() => generateVisual(brief.id)}
                    disabled={!campaignId || Boolean(generatingId) || brief.status === "generated"}
                  >
                    <Sparkle size={15} />
                    {generatingId === brief.id ? "Generating..." : brief.status === "generated" ? "Generated" : brief.status === "failed" ? "Retry" : "Generate"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ProofMiniTab({ pack }: { pack: DeliveryPack }) {
  const repaired = pack.proofReport.claims.filter(
    (claim) => claim.resolutionStatus === "repaired"
  ).length;

  return (
    <div className="proof-tab-stack">
      <section className="proof-mini-summary" aria-label="Proof summary">
        <div className="sum-card"><div className="sum-num">{pack.proofReport.checkedClaims}</div><div className="sum-label">Checked</div></div>
        <div className="sum-card"><div className="sum-num green-text">{pack.proofReport.supported}</div><div className="sum-label">Supported</div></div>
        <div className="sum-card"><div className="sum-num amber-text">{pack.proofReport.unsupported}</div><div className="sum-label">Unsupported</div></div>
        <div className="sum-card"><div className="sum-num red-text">{pack.proofReport.conflicts}</div><div className="sum-label">Conflicts</div></div>
        <div className="sum-card"><div className="sum-num blue-text">{repaired}</div><div className="sum-label">Repaired</div></div>
      </section>
      <ProofTable pack={pack} compact />
    </div>
  );
}

function ProductionTab({ pack }: { pack: DeliveryPack }) {
  return (
    <div className="panel">
      <div className="section-title">Week 1 Production Plan <span>{pack.productionPlan.totalHours}</span></div>
      <table>
        <thead><tr><th>Day</th><th>Task</th><th>Role</th><th>Estimate</th><th>Calendar Links</th></tr></thead>
        <tbody>
          {pack.productionPlan.steps.map((step) => (
            <tr key={`${step.day}-${step.task}`}><td>{step.day}</td><td>{step.task}</td><td>{step.role || "Owner"}</td><td>{step.estimate}</td><td>{step.linkedCalendarIds.join(", ") || "-"}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProofTable({ pack, compact = false }: { pack: DeliveryPack; compact?: boolean }) {
  const [filter, setFilter] = useState<ProofFilter>("all");
  const [selectedId, setSelectedId] = useState(pack.proofReport.claims[0]?.id ?? "");
  const claims = filter === "all"
    ? pack.proofReport.claims
    : filter === "repaired"
      ? pack.proofReport.claims.filter((claim) => claim.resolutionStatus === "repaired")
      : pack.proofReport.claims.filter(
          (claim) =>
            claim.status === filter &&
            (claim.status === "supported" || claim.resolutionStatus === "unresolved")
        );
  const selected = pack.proofReport.claims.find((claim) => claim.id === selectedId) ?? pack.proofReport.claims[0];
  const sourceUrlById = new Map(
    pack.sources
      .filter((source) => source.url && /^https?:\/\//i.test(source.url))
      .map((source) => [source.id, source.url as string])
  );
  const evidenceUrl = (claim: Claim) =>
    claim.repairAction === "removed" || !claim.sourceId ? undefined : sourceUrlById.get(claim.sourceId);
  const sourceLabel = (claim: Claim, missing: string) => {
    if (claim.repairAction === "removed") return "Removed from content";
    const title = claim.sourceTitle ?? missing;
    return claim.sourceType === "web-search" ? title + " (web)" : title;
  };

  return (
    <div className={compact ? "" : "proof-main"}>
      <div className="filter-bar">
        <Funnel size={15} />
        {proofFilters.map((item) => (
          <button key={item.id} className={filter === item.id ? "filter-pill active" : "filter-pill"} onClick={() => setFilter(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      <div className="proof-layout">
        <div className="table-area">
          <table className="proof-table">
            <colgroup>
              <col className="proof-col-claim" />
              <col className="proof-col-used" />
              <col className="proof-col-source" />
              <col className="proof-col-confidence" />
              <col className="proof-col-status" />
            </colgroup>
            <thead><tr><th>Claim</th><th>Content Used In</th><th>Source</th><th>Confidence</th><th>Status</th></tr></thead>
            <tbody>
              {claims.map((claim) => {
                const meta = claimStatusMeta(claim);
                const source = sourceLabel(claim, "Needs source");
                const url = evidenceUrl(claim);
                return (
                  <tr key={claim.id} className={claim.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(claim.id)}>
                    <td>{claim.text}</td>
                    <td>{claim.contentUsedIn}</td>
                    <td>
                      {url ? (
                        <a href={url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{source}</a>
                      ) : source}
                    </td>
                    <td>
                      <div className="mini-bar-wrap"><div className="mini-bar"><div className="mini-bar-fill" style={{ width: claim.confidence + "%" }} /></div>{claim.confidence}%</div>
                    </td>
                    <td><span className={meta.className}>{meta.icon}{meta.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="proof-card-list">
            {claims.map((claim) => {
              const meta = claimStatusMeta(claim);
              const source = sourceLabel(claim, "Needs source");
              return (
                <button key={claim.id} className={claim.id === selected?.id ? "proof-card-row selected" : "proof-card-row"} onClick={() => setSelectedId(claim.id)}>
                  <span className={meta.className}>{meta.icon}{meta.label}</span>
                  <strong>{claim.text}</strong>
                  <span className="proof-card-meta"><b>Used in</b> {claim.contentUsedIn}</span>
                  <span className="proof-card-meta"><b>Source</b> {source}</span>
                  <span className="proof-card-confidence"><span className="mini-bar"><span className="mini-bar-fill" style={{ width: claim.confidence + "%" }} /></span>{claim.confidence}% confidence</span>
                </button>
              );
            })}
          </div>
        </div>
        {!compact && selected ? (
          <aside className="right-drawer">
            <div className="drawer-header">Claim Detail</div>
            <div className="claim-detail-box">{selected.text}</div>
            <div className="detail-row"><span>Status</span><strong>{claimStatusMeta(selected).label}</strong></div>
            <div className="detail-row"><span>Confidence</span><strong>{selected.confidence}%</strong></div>
            <div className="detail-row">
              <span>Source</span>
              <strong>
                {evidenceUrl(selected) ? (
                  <a href={evidenceUrl(selected)} target="_blank" rel="noreferrer">{sourceLabel(selected, "Missing")}</a>
                ) : sourceLabel(selected, "Missing")}
              </strong>
            </div>
            <div className="divider" />
            {selected.evidence.length ? (
              <>
                <div className="section-label">Evidence</div>
                {selected.evidence.map((item) => (
                  <blockquote className="evidence-quote" key={item.sourceId + item.quote.slice(0, 24)}>
                    {item.quote}
                    {item.sectionId ? <cite className="evidence-section">{item.sectionId}</cite> : null}
                  </blockquote>
                ))}
              </>
            ) : null}
            <div className="section-label">{selected.resolutionStatus === "repaired" ? "Repair Note" : "Recommendation"}</div>
            <div className="reco-box">{selected.resolutionStatus === "repaired" ? selected.repairNote : selected.recommendation}</div>
            <button className="btn btn-primary full" onClick={() => copyText(selected.text)}><Copy size={15} /> Copy claim</button>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function ProofView({
  pack,
  canRepair,
  repairing,
  repairError,
  onRepair
}: {
  pack: DeliveryPack;
  canRepair: boolean;
  repairing: boolean;
  repairError: string | null;
  onRepair: () => void;
}) {
  return (
    <main className="page-view">
      <div className="page-header">
        <div>
          <h1>Proof Report</h1>
          <p>{pack.brief.brand} campaign. {pack.proofReport.checkedClaims} claims analyzed.</p>
        </div>
        <div className="btn-group">
          <button className="btn btn-primary" onClick={() => copyText(JSON.stringify(pack.proofReport, null, 2))}><DownloadSimple size={15} /> Export Report</button>
          <button className="btn btn-outline" onClick={onRepair} disabled={!canRepair || repairing}>
            <Wrench size={15} /> {repairing ? "Repairing..." : "Repair Unsupported"}
          </button>
        </div>
      </div>
      {repairError ? <div className="error-box">{repairError}</div> : null}
      <div className="summary-cards">
        <div className="sum-card"><div className="sum-num">{pack.proofReport.checkedClaims}</div><div className="sum-label">Claims Checked</div></div>
        <div className="sum-card"><div className="sum-num green-text">{pack.proofReport.supported}</div><div className="sum-label">Supported</div></div>
        <div className="sum-card"><div className="sum-num amber-text">{pack.proofReport.unsupported}</div><div className="sum-label">Unsupported</div></div>
        <div className="sum-card"><div className="sum-num red-text">{pack.proofReport.conflicts}</div><div className="sum-label">Conflicts</div></div>
        <div className="sum-card"><div className="sum-num blue-text">{pack.proofReport.timeSensitive}</div><div className="sum-label">Time-Sensitive</div></div>
      </div>
      <ProofTable pack={pack} />
    </main>
  );
}
const exportOptions: Array<{
  format: CampaignExportFormat;
  extension: string;
  title: string;
  detail: (pack: DeliveryPack) => string;
}> = [
  {
    format: "strategy",
    extension: "MD",
    title: "Strategy Document",
    detail: (pack) => pack.territories.length + " territories / " + pack.promptRoutes.length + " prompt routes"
  },
  {
    format: "calendar",
    extension: "CSV",
    title: "Campaign Calendar",
    detail: (pack) => pack.calendar.length + " scheduled rows / Excel compatible"
  },
  {
    format: "content-pack",
    extension: "JSON",
    title: "Content Pack",
    detail: (pack) => pack.assets.length + " assets / canonical delivery schema"
  }
];

function ExportView({
  pack,
  campaignId
}: {
  pack: DeliveryPack;
  campaignId: string | null;
}) {
  function downloadExport(format: CampaignExportFormat) {
    if (!campaignId) return;
    const anchor = document.createElement("a");
    anchor.href =
      "/api/campaigns/" + encodeURIComponent(campaignId) +
      "/exports/" + encodeURIComponent(format);
    anchor.download = "";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  const repaired = pack.proofReport.claims.filter(
    (claim) => claim.resolutionStatus === "repaired"
  ).length;

  return (
    <main className="page-view exports-page">
      <div className="page-header">
        <div>
          <h1>Exports</h1>
          <p>{pack.brief.brand} delivery files.</p>
        </div>
        <span className={campaignId ? "badge bg-green" : "badge bg-amber"}>
          {campaignId ? <Check size={13} weight="bold" /> : <Warning size={13} weight="bold" />}
          {campaignId ? "Campaign saved" : "Save required"}
        </span>
      </div>

      <div className="exports-content">
        <section className="export-readiness" aria-label="Export readiness">
          <div><span>Assets</span><strong>{pack.assets.length}</strong></div>
          <div><span>Calendar rows</span><strong>{pack.calendar.length}</strong></div>
          <div><span>Proof issues</span><strong>{pack.proofReport.unsupported + pack.proofReport.conflicts}</strong></div>
          <div><span>Repaired claims</span><strong>{repaired}</strong></div>
        </section>

        {!campaignId ? (
          <div className="error-box">Open a saved campaign before downloading exports.</div>
        ) : null}

        <section className="export-grid">
          {exportOptions.map((option) => (
            <article className="export-format" key={option.format}>
              <div className="export-format-header">
                <span className="export-file-icon"><FileText size={22} weight="duotone" /></span>
                <span className="format-badge">{option.extension}</span>
              </div>
              <div>
                <h2>{option.title}</h2>
                <p>{option.detail(pack)}</p>
              </div>
              <button
                className="btn btn-primary"
                onClick={() => downloadExport(option.format)}
                disabled={!campaignId}
              >
                <DownloadSimple size={15} weight="bold" />
                Download
              </button>
            </article>
          ))}
        </section>

        <section className="export-manifest">
          <div>
            <span className="section-label">Export manifest</span>
            <h2>Canonical campaign snapshot</h2>
          </div>
          <dl>
            <div><dt>Campaign ID</dt><dd>{campaignId ?? "Not saved"}</dd></div>
            <div><dt>Generated</dt><dd>{new Date(pack.generation.generatedAt).toLocaleString()}</dd></div>
            <div><dt>Provider</dt><dd>{pack.generation.provider} / {pack.generation.model}</dd></div>
            <div><dt>Stages</dt><dd>{pack.generationStages.length} completed</dd></div>
            <div><dt>Performance records</dt><dd>{pack.performanceContext.recordCount}</dd></div>
            <div><dt>Sources</dt><dd>{pack.sources.length}</dd></div>
          </dl>
        </section>
      </div>
    </main>
  );
}

type PerformanceMetricField =
  | "impressions"
  | "views"
  | "engagements"
  | "clicks"
  | "conversions"
  | "watchTimeSeconds";

const performanceMetricFields: Array<{ id: PerformanceMetricField; label: string }> = [
  { id: "impressions", label: "Impressions" },
  { id: "views", label: "Views" },
  { id: "engagements", label: "Engagements" },
  { id: "clicks", label: "Clicks" },
  { id: "conversions", label: "Conversions" },
  { id: "watchTimeSeconds", label: "Watch time (sec)" }
];

function performanceInput(assetId: string, record?: PerformanceRecord): PerformanceInput {
  return {
    assetId,
    impressions: record?.impressions ?? 0,
    views: record?.views ?? 0,
    engagements: record?.engagements ?? 0,
    clicks: record?.clicks ?? 0,
    conversions: record?.conversions ?? 0,
    watchTimeSeconds: record?.watchTimeSeconds ?? 0,
    notes: record?.notes ?? ""
  };
}

function percentage(numerator: number, denominator: number) {
  if (!denominator) return "0.00%";
  return ((numerator / denominator) * 100).toFixed(2) + "%";
}

function PerformanceView({
  pack,
  campaignId
}: {
  pack: DeliveryPack;
  campaignId: string | null;
}) {
  const firstAssetId = pack.assets[0]?.id ?? "";
  const [selectedAssetId, setSelectedAssetId] = useState(firstAssetId);
  const [form, setForm] = useState<PerformanceInput>(() => performanceInput(firstAssetId));
  const [records, setRecords] = useState<PerformanceRecord[]>([]);
  const [summary, setSummary] = useState<PerformanceContext | null>(null);
  const [loadingPerformance, setLoadingPerformance] = useState(Boolean(campaignId));
  const [savingPerformance, setSavingPerformance] = useState(false);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!campaignId) {
      setLoadingPerformance(false);
      return;
    }

    const controller = new AbortController();
    async function loadPerformance() {
      setLoadingPerformance(true);
      setPerformanceError(null);
      try {
        const response = await fetch(
          "/api/campaigns/" + encodeURIComponent(campaignId as string) + "/performance",
          { signal: controller.signal }
        );
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load performance.");
        const nextRecords = payload.records as PerformanceRecord[];
        setRecords(nextRecords);
        setSummary(payload.summary as PerformanceContext);
        const current = nextRecords.find((record) => record.assetId === selectedAssetId);
        setForm(performanceInput(selectedAssetId, current));
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") setPerformanceError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoadingPerformance(false);
      }
    }

    void loadPerformance();
    return () => controller.abort();
  }, [campaignId, selectedAssetId]);

  function selectAsset(assetId: string) {
    setSelectedAssetId(assetId);
    setSaved(false);
    setForm(performanceInput(assetId, records.find((record) => record.assetId === assetId)));
  }

  function updateMetric(field: PerformanceMetricField, rawValue: string) {
    const parsed = Number(rawValue);
    const value = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    setSaved(false);
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function saveMetrics() {
    if (!campaignId || !selectedAssetId) {
      setPerformanceError("Open a saved campaign with at least one asset.");
      return;
    }

    setSavingPerformance(true);
    setPerformanceError(null);
    setSaved(false);
    try {
      const response = await fetch(
        "/api/campaigns/" + encodeURIComponent(campaignId) + "/performance",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form)
        }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to save performance.");
      const nextRecords = payload.records as PerformanceRecord[];
      setRecords(nextRecords);
      setSummary(payload.summary as PerformanceContext);
      setForm(performanceInput(selectedAssetId, payload.record as PerformanceRecord));
      setSaved(true);
    } catch (err) {
      setPerformanceError(err instanceof Error ? err.message : "Unable to save performance.");
    } finally {
      setSavingPerformance(false);
    }
  }

  const selectedAsset = pack.assets.find((asset) => asset.id === selectedAssetId);
  const totals = summary?.totals;
  const rates = summary?.rates;
  const number = new Intl.NumberFormat("en-US");

  return (
    <main className="page-view performance-page">
      <div className="page-header">
        <div>
          <h1>Performance</h1>
          <p>{pack.brief.brand} recorded content outcomes.</p>
        </div>
        <span className="badge bg-gray">
          <ChartLineUp size={14} /> {records.length} of {pack.assets.length} assets
        </span>
      </div>

      <div className="performance-content">
        {performanceError ? <div className="error-box">{performanceError}</div> : null}

        <section className="performance-summary-grid" aria-label="Performance summary">
          <div className="performance-stat"><span>Impressions</span><strong>{number.format(totals?.impressions ?? 0)}</strong></div>
          <div className="performance-stat"><span>Engagement rate</span><strong>{(rates?.engagementRate ?? 0).toFixed(2)}%</strong></div>
          <div className="performance-stat"><span>Click-through</span><strong>{(rates?.clickThroughRate ?? 0).toFixed(2)}%</strong></div>
          <div className="performance-stat"><span>Conversions</span><strong>{number.format(totals?.conversions ?? 0)}</strong></div>
          <div className="performance-stat"><span>Avg. watch time</span><strong>{(rates?.averageWatchTimeSeconds ?? 0).toFixed(1)}s</strong></div>
        </section>

        <section className="performance-editor">
          <div className="performance-section-heading">
            <div>
              <span className="section-label">Asset result</span>
              <h2>{selectedAsset?.title ?? "No content assets"}</h2>
            </div>
            {saved ? <span className="badge bg-green"><Check size={13} weight="bold" /> Saved</span> : null}
          </div>

          <label className="form-field">
            <span>Content asset</span>
            <select
              value={selectedAssetId}
              onChange={(event) => selectAsset(event.target.value)}
              disabled={!pack.assets.length || savingPerformance}
            >
              {pack.assets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.title} - {asset.platform}
                </option>
              ))}
            </select>
          </label>

          <div className="performance-form-grid">
            {performanceMetricFields.map((field) => (
              <label className="form-field" key={field.id}>
                <span>{field.label}</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form[field.id]}
                  onChange={(event) => updateMetric(field.id, event.target.value)}
                  disabled={savingPerformance}
                />
              </label>
            ))}
          </div>

          <label className="form-field">
            <span>Outcome notes</span>
            <textarea
              value={form.notes}
              maxLength={1000}
              onChange={(event) => {
                setSaved(false);
                setForm((current) => ({ ...current, notes: event.target.value }));
              }}
              disabled={savingPerformance}
            />
          </label>

          <div className="performance-actions">
            <span>{selectedAsset ? selectedAsset.type + " / " + selectedAsset.platform : ""}</span>
            <button
              className="btn btn-primary"
              onClick={saveMetrics}
              disabled={!campaignId || !selectedAssetId || savingPerformance || loadingPerformance}
            >
              <FloppyDisk size={15} weight="bold" />
              {savingPerformance ? "Saving..." : "Save Result"}
            </button>
          </div>
        </section>

        <section className="performance-records">
          <div className="performance-section-heading">
            <div>
              <span className="section-label">Recorded assets</span>
              <h2>Outcome comparison</h2>
            </div>
          </div>
          {loadingPerformance ? (
            <div className="performance-empty" aria-busy="true">Loading performance</div>
          ) : records.length ? (
            <div className="performance-table-wrap">
              <table className="performance-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Platform</th>
                    <th>Impressions</th>
                    <th>Engagement</th>
                    <th>Clicks</th>
                    <th>Conversions</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id} onClick={() => selectAsset(record.assetId)}>
                      <td><strong>{record.assetTitle}</strong><span>{record.assetType}</span></td>
                      <td><span className={platformClass(record.platform)}>{record.platform}</span></td>
                      <td>{number.format(record.impressions)}</td>
                      <td>{percentage(record.engagements, record.impressions)}</td>
                      <td>{number.format(record.clicks)} <span>{percentage(record.clicks, record.impressions)}</span></td>
                      <td>{number.format(record.conversions)}</td>
                      <td>{new Date(record.updatedAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="performance-empty">No outcomes recorded for this campaign.</div>
          )}
        </section>
      </div>
    </main>
  );
}
function HistoryView({ onOpen }: { onOpen: (pack: DeliveryPack, campaignId: string) => void }) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCampaigns() {
      try {
        const response = await fetch("/api/campaigns", { signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Unable to load campaign history.");
        setCampaigns(payload.campaigns as CampaignSummary[]);
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") setError(err.message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadCampaigns();
    return () => controller.abort();
  }, []);

  async function openCampaign(id: string) {
    setOpeningId(id);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to open campaign.");
      onOpen(payload.pack as DeliveryPack, payload.summary?.id ?? id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open campaign.");
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <main className="page-view history-page">
      <div className="page-header">
        <div>
          <h1>Campaign History</h1>
          <p>Saved delivery packs from Neon.</p>
        </div>
        <span className="badge bg-gray"><ClockCounterClockwise size={14} /> {campaigns.length} saved</span>
      </div>
      <section className="history-content">
        {error ? <div className="error-box">{error}</div> : null}
        {loading ? (
          <div className="history-empty" aria-busy="true">
            <ClockCounterClockwise size={28} />
            <strong>Loading campaign history</strong>
          </div>
        ) : campaigns.length ? (
          <div className="history-table-wrap">
            <table className="history-table">
              <thead><tr><th>Campaign</th><th>Goal</th><th>Provider</th><th>Created</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {campaigns.map((campaign) => (
                  <tr key={campaign.id}>
                    <td><strong>{campaign.brand}</strong><span className="history-id">{campaign.id}</span></td>
                    <td>{campaign.goal}</td>
                    <td><span className="format-badge">{campaign.provider}</span><span className="history-model">{campaign.model}</span></td>
                    <td>{new Date(campaign.createdAt).toLocaleString()}</td>
                    <td>
                      <button className="btn btn-outline history-open" onClick={() => openCampaign(campaign.id)} disabled={Boolean(openingId)}>
                        {openingId === campaign.id ? "Opening..." : "Open"}<ArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !error ? (
          <div className="history-empty">
            <ClockCounterClockwise size={28} />
            <strong>No saved campaigns</strong>
            <span>Your first successful generation will appear here.</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}

export function ContentEngineerApp() {
  const [view, setView] = useState<ViewName>("workbench");
  const [brief, setBrief] = useState<BriefInput>(emptyBrief);
  const [pack, setPack] = useState<DeliveryPack | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredBrief | null>(null);
  const [visualProgress, setVisualProgress] = useState<VisualProgress | null>(null);
  const [liveStages, setLiveStages] = useState<GenerationStage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repairError, setRepairError] = useState<string | null>(null);

  const proofIssueCount = useMemo(
    () => pack ? pack.proofReport.unsupported + pack.proofReport.conflicts : 0,
    [pack]
  );

  function openSavedCampaign(savedPack: DeliveryPack, savedCampaignId: string) {
    setPack(savedPack);
    setCampaignId(savedCampaignId);
    setBrief(savedPack.brief);
    setLiveStages(savedPack.generationStages ?? []);
    setRepairError(null);
    setView("results");
  }

  async function generatePack() {
    setLoading(true);
    setError(null);
    setPack(null);
    setCampaignId(null);
    setRepairError(null);
    setDiscovered(null);
    setVisualProgress(null);
    setLiveStages([]);
    setView("pipeline");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brief)
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error ?? "Generation failed.");
      }

      const generationResult = await readGenerationStream(response, setDiscovered, (stage) => {
        setLiveStages((current) => [
          ...current.filter((item) => item.stage !== stage.stage),
          stage
        ]);
      }, setVisualProgress);
      setLiveStages(generationResult.pack.generationStages);
      setCampaignId(generationResult.campaignId);
      setPack(generationResult.pack);
      setView("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setView("workbench");
    } finally {
      setLoading(false);
    }
  }

  async function repairClaims() {
    if (!campaignId) {
      setRepairError("Save or reopen this campaign before repairing claims.");
      return;
    }

    setRepairing(true);
    setRepairError(null);
    try {
      const response = await fetch(
        "/api/campaigns/" + encodeURIComponent(campaignId) + "/repair-claims",
        { method: "POST" }
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to repair unsupported claims.");
      const repairedPack = payload.pack as DeliveryPack;
      setPack(repairedPack);
      setLiveStages(repairedPack.generationStages);
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : "Unable to repair unsupported claims.");
    } finally {
      setRepairing(false);
    }
  }

  return (
    <>
      <TopNav view={view} setView={setView} hasPack={Boolean(pack)} loading={loading} />
      {view === "workbench" ? <Workbench brief={brief} setBrief={setBrief} pack={pack} onGenerate={generatePack} loading={loading} error={error} /> : null}
      {view === "history" ? <HistoryView onOpen={openSavedCampaign} /> : null}
      {view === "pipeline" ? <PipelineView brief={brief} discovered={discovered} stages={liveStages} visuals={visualProgress} /> : null}
      {view === "results" && pack ? <ResultsView pack={pack} campaignId={campaignId} onPackChange={setPack} /> : null}
      {view === "performance" && pack ? <PerformanceView pack={pack} campaignId={campaignId} /> : null}
      {view === "proof" && pack ? <ProofView pack={pack} canRepair={Boolean(campaignId) && proofIssueCount > 0} repairing={repairing} repairError={repairError} onRepair={repairClaims} /> : null}
      {view === "exports" && pack ? <ExportView pack={pack} campaignId={campaignId} /> : null}
      {proofIssueCount ? <div className="floating-alert"><Warning size={16} weight="fill" /> {proofIssueCount} proof issues need review</div> : null}
    </>
  );
}