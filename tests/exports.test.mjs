import assert from "node:assert/strict";
import test from "node:test";

import { buildClientContentPack, buildStrategyMarkdown, sourceLinksForAsset } from "../lib/exports.ts";

const asset = {
  id: "asset-1",
  type: "article",
  platform: "Medium",
  title: "A sourced article",
  copy: "",
  cta: "Read more",
  linkedClaims: [],
  calendarItemId: "calendar-1",
  seriesId: "",
  segment: "",
  territory: "",
  hookId: "",
  editorialMode: "technical-explainer",
  contentFormat: "article",
  threadPosts: [],
  article: {
    subtitle: "A practical subtitle",
    introduction: "Introduction.",
    sections: [{ heading: "Section", body: "Body." }],
    conclusion: "Conclusion.",
    tags: ["source-backed"]
  },
  visualBriefId: ""
};

const pack = {
  brief: {
    brand: "Arc House",
    industry: "Web3",
    goal: "Publish a sourced campaign",
    audience: "Builders",
    platforms: ["Medium"],
    tone: "Clear",
    editorialProfile: "technical-authority",
    durationDays: 21,
    postsPerWeek: 7
  },
  performanceContext: {
    recordCount: 0
  },
  brandContext: {
    positioning: "Independent builder education",
    voice: [],
    contentGoals: []
  },
  contentLandscape: {
    summary: "",
    opportunityGaps: []
  },
  audienceSegments: [],
  territories: [],
  hooks: [],
  contentSeries: [],
  platformAdaptations: [],
  editorialReport: {
    score: 90,
    passed: true,
    rewriteSummary: ""
  },
  editorialMix: [],
  assets: [asset],
  calendar: [{
    id: "calendar-1",
    day: 1,
    platform: "Medium",
    format: "article",
    audienceSegment: "Builders",
    hook: "Hook",
    sourcePack: ["source-1", "source-without-url"],
    goal: "Educate",
    territory: "Infrastructure",
    series: "",
    episode: "",
    hookId: "",
    platformFitReason: "",
    cta: "Read more",
    productionTaskId: ""
  }],
  sources: [{
    id: "source-1",
    title: "Primary documentation",
    url: "https://example.com/docs",
    sourceType: "primary-doc",
    extractedText: "Documentation",
    fetchedAt: "2026-07-19T00:00:00.000Z",
    fetchStatus: "fetched",
    wordCount: 1,
    sourceQuality: "strong"
  }, {
    id: "source-without-url",
    title: "Internal note",
    sourceType: "user-note",
    extractedText: "Note",
    fetchedAt: "2026-07-19T00:00:00.000Z",
    fetchStatus: "fetched",
    wordCount: 1,
    sourceQuality: "limited"
  }],
  visualBriefs: [],
  proofReport: {
    checkedClaims: 0,
    supported: 0,
    unsupported: 0,
    conflicts: 0,
    timeSensitive: 0,
    claims: []
  },
  productionPlan: {
    totalHours: "4 hours",
    overloadRisk: "low",
    capacitySummary: "Within capacity",
    steps: []
  },
  generation: {
    generatedAt: "2026-07-19T00:00:00.000Z",
    provider: "openai",
    model: "test"
  },
  generationStages: [],
  promptRoutes: []
};

test("resolves public source links for an asset from its calendar entry", () => {
  assert.deepEqual(sourceLinksForAsset(pack, asset), [{
    id: "source-1",
    title: "Primary documentation",
    url: "https://example.com/docs"
  }]);
});

test("adds human-visible source links to each publish-ready asset", () => {
  const markdown = buildStrategyMarkdown(pack);
  assert.match(markdown, /#### Sources/);
  assert.match(markdown, /\[Primary documentation\]\(https:\/\/example\.com\/docs\)/);
  assert.doesNotMatch(markdown, /Internal note/);
});

test("exports only client-facing fields in the content pack", () => {
  const withProof = {
    ...pack,
    inferredFields: ["audience"],
    brandContext: { ...pack.brandContext, prohibitedClaims: [], assumptions: ["Confirm the launch date."] },
    calendar: [{ ...pack.calendar[0], platformFitReason: "Internal planning rationale" }],
    sources: [...pack.sources, {
      id: "src-prompt-library",
      title: "Prompt library",
      sourceType: "prompt-library",
      extractedText: "internal",
      fetchedAt: "2026-07-19T00:00:00.000Z",
      fetchStatus: "fetched",
      authority: "internal"
    }],
    proofReport: {
      ...pack.proofReport,
      checkedClaims: 1,
      supported: 1,
      claims: [{
        id: "claim-1",
        text: "Docs are published.",
        claimKind: "capability",
        status: "supported",
        confidence: 90,
        checkedAt: "2026-07-19T00:00:00.000Z",
        contentUsedIn: "asset-1",
        recommendation: "Keep.",
        evidence: [{ sourceId: "source-1", quote: "Documentation", locator: "", stance: "supports" }]
      }]
    },
    promptRoutes: [{ pipelineStage: "Foundation", selectedPromptName: "secret routing" }]
  };

  const client = buildClientContentPack(withProof);
  const serialized = JSON.stringify(client);
  for (const internal of ["extractedText", "platformFitReason", "promptRoutes", "generationStages", "secret routing", "draftAssets"]) {
    assert.doesNotMatch(serialized, new RegExp(internal), internal + " must not reach the client");
  }
  assert.deepEqual(client.brand.inferredFields, ["audience"]);
  assert.deepEqual(client.strategy.assumptions, ["Confirm the launch date."]);
  assert.equal(client.assets[0].title, "A sourced article");
  assert.deepEqual(client.sources.map((source) => source.id), ["source-1", "source-without-url"]);
  assert.deepEqual(client.proof.claims[0].evidence, [{
    quote: "Documentation",
    stance: "supports",
    source: "Primary documentation",
    url: "https://example.com/docs"
  }]);
});
