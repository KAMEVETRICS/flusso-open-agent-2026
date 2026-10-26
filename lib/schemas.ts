import { z } from "zod";

export const PlatformSchema = z.enum(["X", "LinkedIn", "Newsletter", "Discord", "Mirror", "Medium"]);
// "editorial" marks framing or opinion: reviewed for tone, never fact-checked.
export const ClaimStatusSchema = z.enum(["supported", "unsupported", "conflict", "time-sensitive", "editorial"]);
export const ClaimKindSchema = z.enum([
  "statistic",
  "capability",
  "comparison",
  "attribution",
  "time-bound",
  "framing",
  "opinion",
  "unclassified"
]);
export const SourceAuthoritySchema = z.enum(["first-party", "third-party", "user-supplied", "internal", "unknown"]);

// Models sometimes score confidence on a 0-1 scale; store every confidence as a 0-100 percentage.
export function confidencePercent(value: number) {
  return Math.round(value > 0 && value <= 1 ? value * 100 : value);
}
export const EditorialProfileSchema = z.enum(["balanced", "technical-authority", "founder-led", "direct-growth"]);
export const EditorialModeSchema = z.enum([
  "direct-practical",
  "technical-explainer",
  "point-of-view",
  "storytelling",
  "how-to",
  "proof-led",
  "comparison",
  "community"
]);
export const ContentFormatSchema = z.enum([
  "short-post",
  "thread",
  "article",
  "newsletter",
  "community-post"
]);

export const ProjectBriefSchema = z.object({
  brand: z.string().min(2),
  industry: z.string().min(2),
  website: z.string().url().or(z.literal("")),
  docs: z.string().optional().default(""),
  goal: z.string().min(5),
  audience: z.string().min(3),
  competitors: z.array(z.string()).default([]),
  platforms: z.array(PlatformSchema).default(["X", "LinkedIn"]),
  editorialProfile: EditorialProfileSchema.default("balanced"),
  tone: z.string().min(2),
  durationDays: z.number().int().min(7).max(90),
  postsPerWeek: z.number().int().min(1).max(20),
  teamSize: z.number().int().min(1).max(20),
  hoursPerWeek: z.number().int().min(1).max(80),
  restrictions: z.string().optional().default("")
});

// What a user must supply. Discovery infers the remaining brand fields from the website.
export const BriefInputSchema = z.object({
  website: z.string().trim().url(),
  goal: z.string().trim().min(5),
  brand: z.string().trim().default(""),
  industry: z.string().trim().default(""),
  audience: z.string().trim().default(""),
  tone: z.string().trim().default(""),
  docs: z.string().default(""),
  competitors: z.array(z.string()).default([]),
  platforms: z.array(PlatformSchema).min(1).default(["X", "LinkedIn"]),
  editorialProfile: EditorialProfileSchema.default("balanced"),
  durationDays: z.number().int().min(7).max(90).default(30),
  postsPerWeek: z.number().int().min(1).max(20).default(5),
  teamSize: z.number().int().min(1).max(20).default(1),
  hoursPerWeek: z.number().int().min(1).max(80).default(8),
  restrictions: z.string().default("")
});

export const SourceDocumentSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string().optional(),
  sourceType: z.enum([
    "primary-doc",
    "website",
    "site-index",
    "structured-data",
    "competitor",
    "search-result",
    "web-search",
    "prompt-library",
    "user-note"
  ]),
  extractedText: z.string(),
  fetchedAt: z.string(),
  fetchStatus: z.enum(["fetched", "unfetched", "failed"]).default("unfetched"),
  wordCount: z.number().int().nonnegative().default(0),
  // How much of the source was captured. This says nothing about whether the source is credible.
  completeness: z.enum(["full", "truncated", "failed", "unknown"]).default("unknown"),
  // Who published it: brand-owned pages are self-asserted, third-party pages are independent.
  authority: SourceAuthoritySchema.default("unknown"),
  contentHash: z.string().default(""),
  failureReason: z.string().optional()
});

export const BrandIdentitySchema = z.object({
  sourceUrl: z.string(),
  colorScheme: z.enum(["light", "dark"]).nullable(),
  colors: z.array(z.object({
    role: z.string(),
    value: z.string()
  })),
  headingFont: z.string(),
  bodyFont: z.string(),
  fonts: z.array(z.string()),
  logoUrl: z.string(),
  personality: z.string()
});

export const FactCategorySchema = z.enum(["product", "audience", "proof", "pricing", "competitor", "company"]);

// One citable fact about the brand, extracted once from a source section. The quote is checked
// against the section text before the fact is kept.
export const BrandFactSchema = z.object({
  id: z.string(),
  category: FactCategorySchema,
  statement: z.string(),
  // The company or product a competitor or proof fact names, such as a rival or a partner.
  entity: z.string().default(""),
  sourceId: z.string(),
  sectionId: z.string(),
  quote: z.string(),
  authority: SourceAuthoritySchema,
  timeSensitive: z.boolean().default(false)
});

// A follow-up fetch discovery made to fill a missing fact category.
export const DiscoveryStepSchema = z.object({
  reason: z.string(),
  method: z.enum(["site-page", "web-search"]),
  target: z.string(),
  sourceIds: z.array(z.string()).default([]),
  factsAdded: z.number().int().nonnegative().default(0),
  outcome: z.string()
});

export const FactSheetSchema = z.object({
  facts: z.array(BrandFactSchema).default([]),
  // Required categories that still have no verified fact after discovery.
  gaps: z.array(FactCategorySchema).default([]),
  discoverySteps: z.array(DiscoveryStepSchema).default([]),
  // Facts the model proposed whose quotes were not found in the cited source.
  rejectedFacts: z.number().int().nonnegative().default(0),
  extractionErrors: z.array(z.object({ sourceId: z.string(), reason: z.string() })).default([])
});

export const BrandContextSchema = z.object({
  positioning: z.string(),
  voice: z.array(z.string()),
  verifiedClaims: z.array(z.string()),
  prohibitedClaims: z.array(z.string()),
  contentGoals: z.array(z.string()),
  // Caveats and unconfirmed inferences for the client to review; never mixed into positioning or copy.
  assumptions: z.array(z.string()).default([])
});

export const SuccessCriterionSchema = z.object({
  outcome: z.string(),
  metric: z.string(),
  // A proposed range to agree with the client, not a forecast.
  targetRange: z.string(),
  // "unknown" until measured performance gives a starting point.
  baseline: z.string(),
  measurement: z.string()
});

// The decision every later stage is checked against: whom the campaign serves first, the need it
// meets, what it leaves out, and how success is measured.
export const CampaignStrategySchema = z.object({
  statement: z.string(),
  prioritySegmentId: z.string(),
  audienceNeed: z.string(),
  outOfScope: z.array(z.string()),
  successCriteria: z.array(SuccessCriterionSchema)
});

export const ContentGapSchema = z.object({
  id: z.string(),
  type: z.enum(["topic", "audience", "format", "tone", "saturated-narrative"]),
  name: z.string(),
  evidence: z.string(),
  recommendation: z.string(),
  priority: z.enum(["high", "medium", "low"])
});

export const ContentLandscapeSchema = z.object({
  summary: z.string().default(""),
  competitorPatterns: z.array(z.string()).default([]),
  saturatedNarratives: z.array(z.string()).default([]),
  opportunityGaps: z.array(ContentGapSchema).default([]),
  formatGaps: z.array(ContentGapSchema).default([]),
  toneGaps: z.array(ContentGapSchema).default([]),
  platformInsights: z.array(z.object({
    platform: PlatformSchema,
    insight: z.string(),
    opportunity: z.string()
  })).default([])
}).default({
  summary: "",
  competitorPatterns: [],
  saturatedNarratives: [],
  opportunityGaps: [],
  formatGaps: [],
  toneGaps: [],
  platformInsights: []
});

export const AudienceSegmentSchema = z.object({
  id: z.string().default(""),
  name: z.string(),
  awarenessLevel: z.string(),
  needs: z.array(z.string()),
  objections: z.array(z.string()),
  cta: z.string(),
  messagePositioning: z.string().default(""),
  emotionalTone: z.string().default(""),
  proofPoints: z.array(z.string()).default([]),
  tabooTopics: z.array(z.string()).default([]),
  formatPreferences: z.array(z.string()).default([]),
  primaryPlatform: PlatformSchema.nullable().optional(),
  cadence: z.string().default(""),
  timing: z.string().default("")
});

export const ContentTerritorySchema = z.object({
  id: z.string().default(""),
  name: z.string(),
  rationale: z.string(),
  sampleAngles: z.array(z.string()),
  ownedGap: z.string().default(""),
  audienceSegments: z.array(z.string()).default([]),
  proofAngle: z.string().default("")
});

export const HookSchema = z.object({
  id: z.string(),
  text: z.string(),
  triggerType: z.string(),
  platform: PlatformSchema,
  audienceSegment: z.string(),
  goal: z.string(),
  emotionalDriver: z.string().default(""),
  contentTerritory: z.string().default(""),
  formatPairing: z.string().default(""),
  testHypothesis: z.string().default(""),
  platformFitReason: z.string().default(""),
  // 1-5 fit with the campaign strategy, scored by a separate review; 0 means not scored.
  strategyFit: z.number().int().min(0).max(5).default(0),
  strategyFitReason: z.string().default("")
});

export const ContentSeriesSchema = z.object({
  id: z.string(),
  title: z.string(),
  territory: z.string(),
  targetSegment: z.string(),
  narrativeArc: z.string(),
  episodes: z.array(z.object({
    id: z.string(),
    title: z.string(),
    role: z.string(),
    formats: z.array(z.string())
  })),
  repurposingMap: z.array(z.string()).default([]),
  amplificationPlan: z.array(z.string()).default([])
});

export const PlatformAdaptationSchema = z.object({
  platform: PlatformSchema,
  role: z.string(),
  strongestHookIds: z.array(z.string()),
  reasoning: z.string(),
  formatPairings: z.array(z.string()),
  ctaStyle: z.string()
});

export const CalendarItemSchema = z.object({
  id: z.string(),
  day: z.number().int(),
  platform: PlatformSchema,
  format: z.string(),
  audienceSegment: z.string(),
  hook: z.string(),
  sourcePack: z.array(z.string()),
  goal: z.string(),
  territory: z.string().default(""),
  series: z.string().default(""),
  episode: z.string().default(""),
  hookId: z.string().default(""),
  platformFitReason: z.string().default(""),
  cta: z.string().default(""),
  productionTaskId: z.string().default("")
});

export const ArticleSectionSchema = z.object({
  heading: z.string(),
  body: z.string()
});

export const ArticleContentSchema = z.object({
  subtitle: z.string(),
  introduction: z.string(),
  sections: z.array(ArticleSectionSchema),
  conclusion: z.string(),
  tags: z.array(z.string())
});

export const ContentAssetSchema = z.object({
  id: z.string(),
  type: z.string(),
  platform: PlatformSchema,
  title: z.string(),
  copy: z.string(),
  cta: z.string(),
  linkedClaims: z.array(z.string()),
  calendarItemId: z.string().default(""),
  seriesId: z.string().default(""),
  segment: z.string().default(""),
  territory: z.string().default(""),
  hookId: z.string().default(""),
  editorialMode: EditorialModeSchema.default("direct-practical"),
  contentFormat: ContentFormatSchema.default("short-post"),
  threadPosts: z.array(z.string()).default([]),
  article: ArticleContentSchema.nullable().default(null),
  visualBriefId: z.string().default("")
});

export const EditorialMixItemSchema = z.object({
  mode: EditorialModeSchema,
  percentage: z.number().int().min(0).max(100),
  rationale: z.string()
});

export const EditorialReportSchema = z.object({
  score: z.number().int().min(0).max(100),
  passed: z.boolean(),
  issueCount: z.number().int().nonnegative(),
  strengths: z.array(z.string()),
  rewriteSummary: z.string()
});

export const VisualBriefSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  visualType: z.enum(["editorial-illustration", "concept-diagram", "data-chart", "comparison", "workflow"]),
  purpose: z.string(),
  keyMessage: z.string(),
  dataPoints: z.array(z.string()),
  prompt: z.string(),
  aspectRatio: z.enum(["1:1", "16:9", "4:5"]),
  altText: z.string(),
  sourceIds: z.array(z.string()),
  status: z.enum(["planned", "generated", "failed"]).default("planned")
});

const PerformanceMetricSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const PerformanceInputSchema = z.object({
  assetId: z.string().min(1),
  impressions: PerformanceMetricSchema.default(0),
  views: PerformanceMetricSchema.default(0),
  engagements: PerformanceMetricSchema.default(0),
  clicks: PerformanceMetricSchema.default(0),
  conversions: PerformanceMetricSchema.default(0),
  watchTimeSeconds: PerformanceMetricSchema.default(0),
  notes: z.string().trim().max(1000).default("")
});

export const PerformanceRecordSchema = PerformanceInputSchema.extend({
  id: z.string(),
  campaignId: z.string(),
  platform: PlatformSchema,
  assetTitle: z.string(),
  assetType: z.string(),
  hookId: z.string(),
  territory: z.string(),
  updatedAt: z.string()
});

export const PerformancePatternSchema = z.object({
  key: z.string(),
  label: z.string(),
  records: z.number().int().nonnegative(),
  impressions: PerformanceMetricSchema,
  engagements: PerformanceMetricSchema,
  clicks: PerformanceMetricSchema,
  conversions: PerformanceMetricSchema,
  engagementRate: z.number().nonnegative(),
  clickThroughRate: z.number().nonnegative(),
  conversionRate: z.number().nonnegative()
});

// Which outcome ranks winners, derived from the campaign goal.
export const PerformanceObjectiveSchema = z.enum(["conversion", "traffic", "engagement"]);

export const PerformanceContextSchema = z.object({
  brand: z.string(),
  objective: PerformanceObjectiveSchema.default("engagement"),
  recordCount: z.number().int().nonnegative(),
  campaignCount: z.number().int().nonnegative(),
  totals: z.object({
    impressions: PerformanceMetricSchema,
    views: PerformanceMetricSchema,
    engagements: PerformanceMetricSchema,
    clicks: PerformanceMetricSchema,
    conversions: PerformanceMetricSchema,
    watchTimeSeconds: PerformanceMetricSchema
  }),
  rates: z.object({
    viewRate: z.number().nonnegative(),
    engagementRate: z.number().nonnegative(),
    clickThroughRate: z.number().nonnegative(),
    conversionRate: z.number().nonnegative(),
    averageWatchTimeSeconds: z.number().nonnegative()
  }),
  topAssets: z.array(z.object({
    assetId: z.string(),
    title: z.string(),
    platform: PlatformSchema,
    hookId: z.string(),
    territory: z.string(),
    impressions: PerformanceMetricSchema,
    engagementRate: z.number().nonnegative(),
    clickThroughRate: z.number().nonnegative(),
    conversions: PerformanceMetricSchema
  })),
  platformPatterns: z.array(PerformancePatternSchema),
  hookPatterns: z.array(PerformancePatternSchema),
  territoryPatterns: z.array(PerformancePatternSchema),
  learnings: z.array(z.string())
});

export const ClaimEvidenceSchema = z.object({
  sourceId: z.string(),
  // The heading-delimited section holding the quote, such as "src-project-docs#protocol".
  sectionId: z.string().default(""),
  // Exact passage from the source; code confirms it appears in the source text.
  quote: z.string(),
  locator: z.string().default(""),
  stance: z.enum(["supports", "conflicts"]).default("supports")
});

export const ClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  contentUsedIn: z.string(),
  claimKind: ClaimKindSchema.default("unclassified"),
  sourceId: z.string().optional(),
  sourceTitle: z.string().optional(),
  sourceType: z.string().optional(),
  evidence: z.array(ClaimEvidenceSchema).default([]),
  checkedAt: z.string().default(""),
  confidence: z.preprocess(
    (value) => (typeof value === "number" ? confidencePercent(value) : value),
    z.number().min(0).max(100)
  ),
  status: ClaimStatusSchema,
  recommendation: z.string(),
  resolutionStatus: z.enum(["unresolved", "repaired"]).default("unresolved"),
  repairAction: z.enum(["removed", "replaced-with-supported"]).nullable().default(null),
  repairNote: z.string().default(""),
  repairedAt: z.string().nullable().default(null)
});

export const ProofReportSchema = z.object({
  checkedClaims: z.number(),
  supported: z.number(),
  unsupported: z.number(),
  conflicts: z.number(),
  timeSensitive: z.number(),
  editorial: z.number().default(0),
  claims: z.array(ClaimSchema)
});

export const ProductionPlanSchema = z.object({
  totalHours: z.string(),
  capacitySummary: z.string().default(""),
  overloadRisk: z.enum(["low", "medium", "high"]).default("low"),
  warnings: z.array(z.string()).default([]),
  roleAssignments: z.array(z.object({
    role: z.string(),
    ownerCount: z.number().int().min(1),
    hours: z.string(),
    responsibilities: z.array(z.string())
  })).default([]),
  steps: z.array(z.object({
    id: z.string().default(""),
    day: z.string(),
    task: z.string(),
    estimate: z.string(),
    role: z.string().default(""),
    linkedCalendarIds: z.array(z.string()).default([])
  }))
});

export const PromptRouteSchema = z.object({
  pipelineStage: z.string(),
  selectedPromptId: z.string(),
  selectedPromptName: z.string(),
  libraryStage: z.string(),
  matchScore: z.number().nonnegative(),
  reason: z.string(),
  tags: z.array(z.string()),
  promptPreview: z.string()
});

export const PromptModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  libraryStage: z.string(),
  useCase: z.string(),
  capability: z.string(),
  outputArtifact: z.string(),
  dependsOn: z.array(z.string()),
  usedInMvp: z.boolean(),
  tags: z.array(z.string())
});

export const PromptLibrarySummarySchema = z.object({
  loaded: z.boolean(),
  sourceFile: z.string(),
  totalPrompts: z.number().int().nonnegative(),
  routedStages: z.number().int().nonnegative(),
  routerVersion: z.string()
});

export const GenerationMetadataSchema = z.object({
  provider: z.string(),
  model: z.string(),
  mode: z.literal("llm"),
  generatedAt: z.string()
});

export const GenerationStageSchema = z.object({
  stage: z.enum(["foundation", "architecture", "execution", "editorial", "governance", "verification"]),
  label: z.string(),
  status: z.literal("completed"),
  startedAt: z.string(),
  completedAt: z.string(),
  durationMs: z.number().int().nonnegative(),
  outputKeys: z.array(z.string())
});

export const DeliveryPackSchema = z.object({
  brief: ProjectBriefSchema,
  sources: z.array(SourceDocumentSchema),
  brandIdentity: BrandIdentitySchema.nullable().default(null),
  // Brief fields inferred from the website rather than stated by the user.
  inferredFields: z.array(z.string()).default([]),
  factSheet: FactSheetSchema.default({ facts: [], gaps: [], discoverySteps: [], rejectedFacts: 0, extractionErrors: [] }),
  brandContext: BrandContextSchema,
  strategy: CampaignStrategySchema.nullable().default(null),
  contentLandscape: ContentLandscapeSchema,
  audienceSegments: z.array(AudienceSegmentSchema),
  territories: z.array(ContentTerritorySchema),
  hooks: z.array(HookSchema),
  // Hook candidates the strategy review scored too low to use.
  droppedHooks: z.array(HookSchema).default([]),
  contentSeries: z.array(ContentSeriesSchema).default([]),
  platformAdaptations: z.array(PlatformAdaptationSchema).default([]),
  editorialMix: z.array(EditorialMixItemSchema).default([]),
  calendar: z.array(CalendarItemSchema),
  draftAssets: z.array(ContentAssetSchema).default([]),
  assets: z.array(ContentAssetSchema),
  editorialReport: EditorialReportSchema.default({
    score: 0,
    passed: false,
    issueCount: 0,
    strengths: [],
    rewriteSummary: ""
  }),
  visualBriefs: z.array(VisualBriefSchema).default([]),
  performanceContext: PerformanceContextSchema.default({
    brand: "",
    recordCount: 0,
    campaignCount: 0,
    totals: { impressions: 0, views: 0, engagements: 0, clicks: 0, conversions: 0, watchTimeSeconds: 0 },
    rates: { viewRate: 0, engagementRate: 0, clickThroughRate: 0, conversionRate: 0, averageWatchTimeSeconds: 0 },
    topAssets: [],
    platformPatterns: [],
    hookPatterns: [],
    territoryPatterns: [],
    learnings: []
  }),
  proofReport: ProofReportSchema,
  promptLibrary: PromptLibrarySummarySchema,
  promptRoutes: z.array(PromptRouteSchema),
  promptModules: z.array(PromptModuleSchema).default([]),
  generation: GenerationMetadataSchema,
  generationStages: z.array(GenerationStageSchema).default([]),
  productionPlan: ProductionPlanSchema
});

export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;
export type BriefInput = z.infer<typeof BriefInputSchema>;
export type EditorialProfile = z.infer<typeof EditorialProfileSchema>;
export type EditorialMode = z.infer<typeof EditorialModeSchema>;
export type ContentFormat = z.infer<typeof ContentFormatSchema>;
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;
export type SourceAuthority = z.infer<typeof SourceAuthoritySchema>;
export type ClaimKind = z.infer<typeof ClaimKindSchema>;
export type ClaimEvidence = z.infer<typeof ClaimEvidenceSchema>;
export type BrandIdentity = z.infer<typeof BrandIdentitySchema>;
export type FactCategory = z.infer<typeof FactCategorySchema>;
export type BrandFact = z.infer<typeof BrandFactSchema>;
export type DiscoveryStep = z.infer<typeof DiscoveryStepSchema>;
export type FactSheet = z.infer<typeof FactSheetSchema>;
export type BrandContext = z.infer<typeof BrandContextSchema>;
export type SuccessCriterion = z.infer<typeof SuccessCriterionSchema>;
export type CampaignStrategy = z.infer<typeof CampaignStrategySchema>;
export type ContentGap = z.infer<typeof ContentGapSchema>;
export type ContentLandscape = z.infer<typeof ContentLandscapeSchema>;
export type AudienceSegment = z.infer<typeof AudienceSegmentSchema>;
export type ContentTerritory = z.infer<typeof ContentTerritorySchema>;
export type Hook = z.infer<typeof HookSchema>;
export type ContentSeries = z.infer<typeof ContentSeriesSchema>;
export type PlatformAdaptation = z.infer<typeof PlatformAdaptationSchema>;
export type CalendarItem = z.infer<typeof CalendarItemSchema>;
export type ContentAsset = z.infer<typeof ContentAssetSchema>;
export type EditorialMixItem = z.infer<typeof EditorialMixItemSchema>;
export type EditorialReport = z.infer<typeof EditorialReportSchema>;
export type VisualBrief = z.infer<typeof VisualBriefSchema>;
export type PerformanceInput = z.infer<typeof PerformanceInputSchema>;
export type PerformanceRecord = z.infer<typeof PerformanceRecordSchema>;
export type PerformancePattern = z.infer<typeof PerformancePatternSchema>;
export type PerformanceObjective = z.infer<typeof PerformanceObjectiveSchema>;
export type PerformanceContext = z.infer<typeof PerformanceContextSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type ProofReport = z.infer<typeof ProofReportSchema>;
export type PromptRoute = z.infer<typeof PromptRouteSchema>;
export type PromptModule = z.infer<typeof PromptModuleSchema>;
export type PromptLibrarySummary = z.infer<typeof PromptLibrarySummarySchema>;
export type GenerationStage = z.infer<typeof GenerationStageSchema>;
export type DeliveryPack = z.infer<typeof DeliveryPackSchema>;
