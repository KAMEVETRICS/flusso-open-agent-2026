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

test("exports the strategy, fact sheet, and core messages", () => {
  const planned = {
    ...pack,
    audienceSegments: [{ id: "segment-1", name: "Builders", awarenessLevel: "Aware", messagePositioning: "", emotionalTone: "", primaryPlatform: "Medium", cta: "Try it", needs: [], objections: [] }],
    strategy: {
      statement: "Help builders ship sourced campaigns by showing every claim's evidence.",
      prioritySegmentId: "segment-1",
      audienceNeed: "Credible claims without a research team.",
      outOfScope: ["Pricing promises"],
      successCriteria: [{ outcome: "Trials", metric: "Trial sign-ups", targetRange: "20-40", baseline: "unknown", measurement: "Signup form, campaign links" }]
    },
    factSheet: {
      facts: [{
        id: "fact-1",
        category: "product",
        statement: "Arc House checks every claim against a source.",
        entity: "",
        sourceId: "source-1",
        sectionId: "source-1#intro",
        quote: "Every claim is checked against the passage that supports it.",
        authority: "first-party",
        timeSensitive: false
      }],
      gaps: ["pricing"],
      discoverySteps: [{ reason: "pricing gap", method: "web-search", target: "Arc House pricing fees", sourceIds: [], factsAdded: 0, outcome: "No readable results" }],
      rejectedFacts: 0,
      extractionErrors: []
    },
    contentItems: [{ id: "item-1", coreMessage: "Evidence beats volume.", segmentId: "segment-1", territoryId: "", seriesId: "", hookId: "", factIds: ["fact-1"], platforms: ["Medium"] }],
    assets: [{ ...asset, contentItemId: "item-1" }]
  };

  const markdown = buildStrategyMarkdown(planned);
  assert.match(markdown, /## Campaign Strategy\n\n> Help builders ship sourced campaigns/);
  assert.match(markdown, /\*\*Priority segment:\*\* Builders/);
  assert.match(markdown, /\| Trials \| Trial sign-ups \| 20-40 \| unknown \|/);
  assert.match(markdown, /### Product\n\n- Arc House checks every claim against a source\. — "Every claim is checked/);
  assert.match(markdown, /Discovery found no verified fact for: pricing\./);
  assert.match(markdown, /\*\*pricing gap \(web-search\):\*\* Arc House pricing fees — No readable results/);
  assert.match(markdown, /\*\*item-1:\*\* Evidence beats volume\.\n {2}- Renditions: Medium article/);

  const content = buildClientContentPack(planned);
  assert.equal(content.version, 3);
  assert.equal(content.strategy.statement, planned.strategy.statement);
  assert.deepEqual(content.factSheet.missingEvidence, ["pricing"]);
  assert.equal(content.factSheet.facts[0].url, "https://example.com/docs");
  assert.deepEqual(content.contentItems[0].assetIds, ["asset-1"]);
  assert.equal(content.assets[0].contentItemId, "item-1");
  assert.equal("sectionId" in content.factSheet.facts[0], false, "section IDs are internal");
});
