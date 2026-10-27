import path from "node:path";
import { HMEM } from "../../vendor/meterless/hmem/index";
import type { MemoryRecord } from "../../vendor/meterless/hmem/index";
import type { DeliveryPack } from "../schemas";
import type { AgentPlan } from "./schemas";
import type { Tracer } from "./trace";

// Meterless H-MEM engine, mounted as Flusso's memory across campaigns for one brand. After each
// campaign the governance outcome (which claims failed verification, and why) and the agent's
// verified decisions are stored as tiered memories with provenance. The next campaign for the same
// domain recalls them before it plans. Every read and write lands in H-MEM's own trust ledger.

export type RecalledMemory = { id: string; content: string; relevance: number; tags: string[]; provenance: string };

const MAX_CLAIM_MEMORIES = 8;

export function openBrandMemory(domain: string, baseDirectory?: string, clock?: () => number) {
  return new HMEM({
    actor: "flusso-agent",
    clock,
    persistDir: baseDirectory ? path.join(baseDirectory, domain.replace(/[^a-z0-9.-]/gi, "_")) : undefined
  });
}

export function recallForCampaign(memory: HMEM, goal: string, tracer: Tracer): RecalledMemory[] {
  const result = memory.query(goal + " claim verification unsupported decision outcome", { topN: 8, threshold: 0.2 });
  const recalled = result.memories.map(({ memory: record, relevance }) => ({
    id: record.id,
    content: record.content,
    relevance: Number(relevance.toFixed(3)),
    tags: record.tags,
    provenance: record.provenance.label
  }));
  tracer.write("trace", "h-mem", "recall", {
    query: goal,
    strategy: result.trace.strategy,
    scores: result.trace.scores,
    recalled: recalled.map((item) => item.id),
    storeSize: memory.store.all().length
  });
  return recalled;
}

function claimLesson(claim: DeliveryPack["proofReport"]["claims"][number], campaignId: string) {
  const repaired = claim.resolutionStatus === "repaired" ? " It was " + (claim.repairAction ?? "repaired").replace(/-/g, " ") + " before release." : "";
  return "A " + claim.claimKind + " claim failed verification (" + claim.status + ") in campaign " + campaignId + ": \"" +
    claim.text.slice(0, 240) + "\". Reviewer: " + claim.recommendation.slice(0, 240) + repaired;
}

export function rememberCampaignOutcome(
  memory: HMEM,
  input: { campaignId: string; pack: DeliveryPack; plan: AgentPlan | null; learnedAt: number },
  tracer: Tracer
): MemoryRecord[] {
  const { campaignId, pack, plan } = input;
  const written: MemoryRecord[] = [];
  const provenance = (label: string, refs: string[]) => ({ origin: "plan_completion" as const, learnedAt: input.learnedAt, label, refs });

  const failed = pack.proofReport.claims.filter((claim) => claim.status === "unsupported" || claim.status === "conflict");
  for (const claim of failed.slice(0, MAX_CLAIM_MEMORIES)) {
    written.push(memory.add({
      content: claimLesson(claim, campaignId),
      type: "factual",
      tags: ["claim-risk", claim.claimKind, claim.status],
      confidence: 0.85,
      source: "campaign:" + campaignId,
      provenance: provenance("Governance outcome of campaign " + campaignId, [campaignId, claim.id])
    }));
  }

  const { checkedClaims, supported } = pack.proofReport;
  written.push(memory.add({
    content: "Campaign " + campaignId + " (" + pack.brief.goal.slice(0, 160) + ") scored " + pack.editorialReport.score +
      "/100 in editorial review with " + supported + " of " + checkedClaims + " checked claims supported and " + failed.length + " failing verification.",
    type: "general",
    layer: "long_term",
    tags: ["campaign-outcome"],
    confidence: 0.95,
    source: "campaign:" + campaignId,
    provenance: provenance("Editorial and proof report of campaign " + campaignId, [campaignId])
  }));

  const accepted = plan?.decisions.filter((decision) => decision.status === "accepted") ?? [];
  for (const decision of accepted) {
    written.push(memory.add({
      content: "Evidence-planning decision (" + decision.kind + ") for \"" + pack.brief.goal.slice(0, 120) + "\": " + decision.statement,
      type: "preference",
      tags: ["decision", decision.kind],
      confidence: decision.confidence / 100,
      source: "agent-plan:" + (plan?.runId ?? ""),
      provenance: provenance("Verified decision " + decision.id + " of agent run " + (plan?.runId ?? ""), [campaignId, ...decision.evidenceIds]),
      derivedFrom: decision.evidenceIds.filter((id) => id.startsWith("mem-"))
    }));
  }

  // Recalled memories that fed accepted decisions earn trust when the campaign shipped with no
  // failing claims, and lose a little when it did not.
  const cited = new Set(accepted.flatMap((decision) => decision.evidenceIds.filter((id) => id.startsWith("mem-"))));
  for (const id of cited) {
    if (!memory.store.get(id)) continue;
    memory.feedback(id, failed.length === 0 ? "helpful" : "not_helpful");
  }

  tracer.write("audit", "h-mem", "remember.campaign", {
    campaignId,
    written: written.map((record) => ({ id: record.id, layer: record.layer, tags: record.tags })),
    feedback: [...cited]
  });
  return written;
}
