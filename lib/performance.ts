import {
  PerformanceContextSchema,
  type PerformanceContext,
  type PerformanceObjective,
  type PerformancePattern,
  type PerformanceRecord
} from "./schemas";

const CONVERSION_GOAL = /\b(onboard\w*|sign[- ]?ups?|convert\w*|conversions?|trials?|purchas\w*|buy\w*|sales?|deposit\w*|mint\w*|regist\w*|install\w*|downloads?|leads?|demos?|subscri\w*|waitlist|activat\w*)\b/i;
const TRAFFIC_GOAL = /\b(traffic|clicks?|visits?|visitors?|click-through)\b/i;

// The campaign goal decides which outcome counts as winning; engagement is the fallback.
export function performanceObjective(goal: string): PerformanceObjective {
  if (CONVERSION_GOAL.test(goal)) return "conversion";
  if (TRAFFIC_GOAL.test(goal)) return "traffic";
  return "engagement";
}

function rate(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function total(records: PerformanceRecord[], key: "impressions" | "views" | "engagements" | "clicks" | "conversions" | "watchTimeSeconds") {
  return records.reduce((sum, record) => sum + record[key], 0);
}

type Ranked = { impressions: number; conversions: number; engagementRate: number; clickThroughRate: number };

// Conversions are compared per impression so items with more exposure do not win by volume alone.
function compareFor(objective: PerformanceObjective) {
  return (left: Ranked, right: Ranked) => {
    const conversion = rate(right.conversions, right.impressions) - rate(left.conversions, left.impressions);
    const byObjective = {
      conversion: [conversion, right.conversions - left.conversions, right.clickThroughRate - left.clickThroughRate],
      traffic: [right.clickThroughRate - left.clickThroughRate, conversion, right.engagementRate - left.engagementRate],
      engagement: [right.engagementRate - left.engagementRate, right.clickThroughRate - left.clickThroughRate, right.conversions - left.conversions]
    }[objective];
    return byObjective.find((difference) => difference !== 0) ?? right.impressions - left.impressions;
  };
}

function patternsFor(
  records: PerformanceRecord[],
  objective: PerformanceObjective,
  keyFor: (record: PerformanceRecord) => string,
  labelFor: (record: PerformanceRecord) => string
): PerformancePattern[] {
  const groups = new Map<string, { label: string; records: PerformanceRecord[] }>();

  for (const record of records) {
    const key = keyFor(record).trim();
    if (!key) continue;
    const current = groups.get(key) ?? { label: labelFor(record), records: [] };
    current.records.push(record);
    groups.set(key, current);
  }

  return Array.from(groups, ([key, group]) => {
    const impressions = total(group.records, "impressions");
    const engagements = total(group.records, "engagements");
    const clicks = total(group.records, "clicks");
    const conversions = total(group.records, "conversions");
    return {
      key,
      label: group.label,
      records: group.records.length,
      impressions,
      engagements,
      clicks,
      conversions,
      engagementRate: rate(engagements, impressions),
      clickThroughRate: rate(clicks, impressions),
      conversionRate: rate(conversions, clicks)
    };
  }).sort(compareFor(objective));
}

function describeLeader(pattern: PerformancePattern, objective: PerformanceObjective) {
  const sample = " across " + pattern.records + " recorded asset(s) and " + pattern.impressions + " impressions.";
  if (objective === "conversion") {
    return "the most conversions per impression at " + rate(pattern.conversions, pattern.impressions).toFixed(2) + "% (" + pattern.conversions + " conversions)" + sample;
  }
  if (objective === "traffic") return "the highest click-through rate at " + pattern.clickThroughRate.toFixed(2) + "%" + sample;
  return "the highest engagement rate at " + pattern.engagementRate.toFixed(2) + "%" + sample;
}

export function emptyPerformanceContext(brand: string, objective: PerformanceObjective = "engagement"): PerformanceContext {
  return {
    brand,
    objective,
    recordCount: 0,
    campaignCount: 0,
    totals: {
      impressions: 0,
      views: 0,
      engagements: 0,
      clicks: 0,
      conversions: 0,
      watchTimeSeconds: 0
    },
    rates: {
      viewRate: 0,
      engagementRate: 0,
      clickThroughRate: 0,
      conversionRate: 0,
      averageWatchTimeSeconds: 0
    },
    topAssets: [],
    platformPatterns: [],
    hookPatterns: [],
    territoryPatterns: [],
    learnings: []
  };
}

export function summarizePerformance(records: PerformanceRecord[], brand: string, goal: string): PerformanceContext {
  const objective = performanceObjective(goal);
  if (!records.length) return emptyPerformanceContext(brand, objective);

  const impressions = total(records, "impressions");
  const views = total(records, "views");
  const engagements = total(records, "engagements");
  const clicks = total(records, "clicks");
  const conversions = total(records, "conversions");
  const watchTimeSeconds = total(records, "watchTimeSeconds");
  const platformPatterns = patternsFor(records, objective, (record) => record.platform, (record) => record.platform);
  const hookPatterns = patternsFor(records, objective, (record) => record.hookId, (record) => record.hookId);
  const territoryPatterns = patternsFor(records, objective, (record) => record.territory, (record) => record.territory);
  const topAssets = records
    .map((record) => ({
      assetId: record.assetId,
      title: record.assetTitle,
      platform: record.platform,
      hookId: record.hookId,
      territory: record.territory,
      impressions: record.impressions,
      engagementRate: rate(record.engagements, record.impressions),
      clickThroughRate: rate(record.clicks, record.impressions),
      conversions: record.conversions
    }))
    .sort(compareFor(objective))
    .slice(0, 5);

  const learnings: string[] = [];
  const leaders: Array<[string, PerformancePattern | undefined]> = [
    ["platform", platformPatterns[0]],
    ["hook", hookPatterns[0]],
    ["territory", territoryPatterns[0]]
  ];
  for (const [kind, leader] of leaders) {
    if (leader) learnings.push("The " + kind + " " + leader.label + " has " + describeLeader(leader, objective));
  }

  return PerformanceContextSchema.parse({
    brand,
    objective,
    recordCount: records.length,
    campaignCount: new Set(records.map((record) => record.campaignId)).size,
    totals: { impressions, views, engagements, clicks, conversions, watchTimeSeconds },
    rates: {
      viewRate: rate(views, impressions),
      engagementRate: rate(engagements, impressions),
      clickThroughRate: rate(clicks, impressions),
      conversionRate: rate(conversions, clicks),
      averageWatchTimeSeconds: views ? Math.round((watchTimeSeconds / views) * 100) / 100 : 0
    },
    topAssets,
    platformPatterns,
    hookPatterns,
    territoryPatterns,
    learnings
  });
}
