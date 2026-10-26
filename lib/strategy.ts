import type { AudienceSegment, CampaignStrategy } from "./schemas";

export const MAX_STRATEGY_WORDS = 30;
// Hooks scored below this by the strategy review are dropped, unless too few would remain.
export const MIN_STRATEGY_FIT = 3;
export const MIN_KEPT_HOOKS = 5;

export function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

// Resolves the priority segment by ID or name, and keeps baselines "unknown" until measured
// performance exists, so a target is never compared against an invented starting point.
export function normalizeStrategy(
  strategy: CampaignStrategy,
  segments: Array<Pick<AudienceSegment, "id" | "name">>,
  hasPerformanceRecords: boolean
): { strategy: CampaignStrategy; warnings: string[] } {
  const warnings: string[] = [];
  const requested = strategy.prioritySegmentId.trim();
  const segment = segments.find((item) => item.id === requested) ??
    segments.find((item) => item.name.trim().toLowerCase() === requested.toLowerCase());
  if (!segment) warnings.push("Strategy names an unknown priority segment: " + (requested || "(none)") + ".");
  const words = wordCount(strategy.statement);
  if (words > MAX_STRATEGY_WORDS) warnings.push("Strategy statement runs " + words + " words; the limit is " + MAX_STRATEGY_WORDS + ".");

  return {
    strategy: {
      ...strategy,
      statement: strategy.statement.trim(),
      prioritySegmentId: segment?.id ?? "",
      outOfScope: strategy.outOfScope.map((item) => item.trim()).filter(Boolean),
      successCriteria: strategy.successCriteria.map((criterion) => ({
        ...criterion,
        baseline: hasPerformanceRecords ? criterion.baseline.trim() || "unknown" : "unknown"
      }))
    },
    warnings
  };
}

export type HookReview = { hookId: string; strategyFit: number; reason: string };

// Applies review scores, drops hooks below MIN_STRATEGY_FIT while keeping at least MIN_KEPT_HOOKS
// (best scores first, original order on ties), and renumbers the kept hooks hook-1, hook-2, ...
type Reviewed<T> = T & { strategyFit: number; strategyFitReason: string };

export function applyHookReview<T extends { id: string }>(
  hooks: T[],
  reviews: HookReview[]
): { kept: Array<Reviewed<T>>; dropped: Array<Reviewed<T>>; idMap: Map<string, string> } {
  const reviewById = new Map(reviews.map((review) => [review.hookId, review]));
  const scored = hooks.map((hook, index) => {
    const review = reviewById.get(hook.id);
    return {
      index,
      hook: { ...hook, strategyFit: review?.strategyFit ?? 0, strategyFitReason: review?.reason.trim() ?? "" }
    };
  });
  const passing = scored.filter((item) => item.hook.strategyFit >= MIN_STRATEGY_FIT);
  const keep = new Set(passing.map((item) => item.index));
  if (keep.size < MIN_KEPT_HOOKS) {
    const ranked = [...scored].sort((left, right) => right.hook.strategyFit - left.hook.strategyFit || left.index - right.index);
    for (const item of ranked) {
      if (keep.size >= MIN_KEPT_HOOKS) break;
      keep.add(item.index);
    }
  }

  const idMap = new Map<string, string>();
  const kept: Array<Reviewed<T>> = [];
  const dropped: Array<Reviewed<T>> = [];
  for (const item of scored) {
    if (keep.has(item.index)) {
      const id = "hook-" + (kept.length + 1);
      idMap.set(item.hook.id, id);
      kept.push({ ...item.hook, id });
    } else {
      dropped.push(item.hook);
    }
  }
  return { kept, dropped, idMap };
}
