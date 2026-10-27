import type { AgentPlan } from "./schemas";

// The accepted decisions as the instruction block every campaign stage reads.
export function decisionsForPrompt(plan: AgentPlan | null) {
  const accepted = plan?.decisions.filter((decision) => decision.status === "accepted") ?? [];
  if (!accepted.length) return "";
  return "\n\nEvidence-planning decisions (JSON). Each one was checked in code against the Zetaris rows, world-model facts, or memories it cites. " +
    "Follow them; the brand fact sheet still decides what is true:\n" +
    JSON.stringify(accepted.map(({ id, kind, statement, rationale }) => ({ id, kind, statement, rationale })));
}
