import { BriefInputSchema, type BriefInput } from "./schemas";
import { normalizeWebsite } from "./discovery-helpers";

export const emptyBrief: BriefInput = {
  website: "",
  goal: "",
  brand: "",
  industry: "",
  audience: "",
  tone: "",
  docs: "",
  competitors: [],
  platforms: ["X", "LinkedIn"],
  editorialProfile: "balanced",
  durationDays: 30,
  postsPerWeek: 5,
  teamSize: 1,
  hoursPerWeek: 8,
  restrictions: ""
};

export function normalizeBrief(input: unknown): BriefInput {
  const record = typeof input === "object" && input ? { ...(input as Record<string, unknown>) } : {};

  if (typeof record.website === "string") {
    record.website = normalizeWebsite(record.website);
  }
  if (typeof record.competitors === "string") {
    record.competitors = record.competitors.split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof record.platforms === "string") {
    record.platforms = record.platforms.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return BriefInputSchema.parse(record);
}
