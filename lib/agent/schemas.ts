import { z } from "zod";

// What the model returns at each reasoning step, and the verified plan the campaign pipeline
// receives. Decisions cite evidence IDs; code, not the model, decides which citations hold.

export const TOOL_NAMES = [
  "campaign_history",
  "claim_risk",
  "claim_risk_baseline",
  "unsupported_claims",
  "performance",
  "prior_evidence",
  "audience_signals",
  "attention_trend"
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const DECISION_KINDS = ["claim_policy", "evidence_reuse", "channel_priority", "angle", "audience", "risk_flag"] as const;

export const ToolPlanSchema = z.object({
  hypothesis: z.string(),
  calls: z.array(z.object({
    tool: z.enum(TOOL_NAMES),
    // Search terms; only prior_evidence uses them.
    terms: z.array(z.string()),
    reason: z.string()
  })).max(8)
});

export const ProposedDecisionSchema = z.object({
  id: z.string(),
  kind: z.enum(DECISION_KINDS),
  // The instruction the campaign pipeline will follow, written for the stage that applies it.
  statement: z.string(),
  rationale: z.string(),
  evidenceIds: z.array(z.string()),
  confidence: z.number().min(0).max(100)
});

export const DecisionSetSchema = z.object({
  decisions: z.array(ProposedDecisionSchema).max(8),
  openQuestions: z.array(z.string()).max(5)
});

export const VerifiedDecisionSchema = ProposedDecisionSchema.extend({
  status: z.enum(["accepted", "rejected"]),
  // Why code rejected the decision; empty when accepted.
  verification: z.string(),
  revised: z.boolean()
});

export const AgentPlanSchema = z.object({
  runId: z.string(),
  mode: z.enum(["live", "sample"]),
  provider: z.string(),
  models: z.array(z.string()),
  hypothesis: z.string(),
  decisions: z.array(VerifiedDecisionSchema),
  openQuestions: z.array(z.string()),
  evidence: z.object({
    zetarisQueries: z.number().int(),
    zetarisRows: z.number().int(),
    worldFacts: z.number().int(),
    memories: z.number().int(),
    tools: z.array(z.string())
  }),
  dataQuality: z.array(z.object({ rule: z.string(), total: z.number(), valid: z.number(), invalid: z.number() })),
  durationMs: z.number().int()
});

export type ToolPlan = z.infer<typeof ToolPlanSchema>;
export type ProposedDecision = z.infer<typeof ProposedDecisionSchema>;
export type DecisionSet = z.infer<typeof DecisionSetSchema>;
export type VerifiedDecision = z.infer<typeof VerifiedDecisionSchema>;
export type AgentPlan = z.infer<typeof AgentPlanSchema>;
