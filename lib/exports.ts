import type { ContentAsset, DeliveryPack } from "./schemas";

export type CampaignExportFormat = "strategy" | "calendar" | "content-pack";

export type CampaignExport = {
  content: string;
  contentType: string;
  filename: string;
};

function cleanLine(value: string) {
  return value.replace(/\r?\n/g, " ").trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "campaign";
}

function exportBaseName(pack: DeliveryPack) {
  return slugify(pack.brief.brand) + "-" + pack.generation.generatedAt.slice(0, 10);
}

function addBullets(lines: string[], values: string[], emptyLabel = "None recorded.") {
  if (!values.length) {
    lines.push("- " + emptyLabel);
    return;
  }
  values.forEach((value) => lines.push("- " + cleanLine(value)));
}

function markdownCell(value: string | number) {
  return cleanLine(String(value)).replace(/\|/g, "\\|");
}

export function sourceLinksForAsset(pack: DeliveryPack, asset: ContentAsset) {
  const calendarItem = pack.calendar.find((item) => item.id === asset.calendarItemId);
  if (!calendarItem) {
    return [];
  }

  const sourcesById = new Map(pack.sources.map((source) => [source.id, source]));
  return calendarItem.sourcePack.flatMap((sourceId) => {
    const source = sourcesById.get(sourceId);
    if (!source?.url) {
      return [];
    }
    return [{
      id: source.id,
      title: cleanLine(source.title),
      url: source.url
    }];
  });
}

export function buildStrategyMarkdown(pack: DeliveryPack) {
  const lines: string[] = [];
  const repairedClaims = pack.proofReport.claims.filter(
    (claim) => claim.resolutionStatus === "repaired"
  ).length;

  lines.push("# " + cleanLine(pack.brief.brand) + " Content Strategy", "");
  lines.push(
    "Generated " + pack.generation.generatedAt +
    " with " + pack.generation.provider + " / " + pack.generation.model + ".",
    ""
  );

  lines.push("## Executive Brief", "");
  lines.push("- **Industry:** " + cleanLine(pack.brief.industry));
  lines.push("- **Goal:** " + cleanLine(pack.brief.goal));
  lines.push("- **Audience:** " + cleanLine(pack.brief.audience));
  lines.push("- **Platforms:** " + pack.brief.platforms.join(", "));
  lines.push("- **Tone:** " + cleanLine(pack.brief.tone));
  lines.push("- **Editorial profile:** " + pack.brief.editorialProfile);
  lines.push("- **Campaign length:** " + pack.brief.durationDays + " days");
  lines.push("- **Publishing cadence:** " + pack.brief.postsPerWeek + " posts per week");
  lines.push("");

  if (pack.strategy) {
    const priority = pack.audienceSegments.find((segment) => segment.id === pack.strategy?.prioritySegmentId);
    lines.push("## Campaign Strategy", "", "> " + cleanLine(pack.strategy.statement), "");
    lines.push("- **Priority segment:** " + (priority ? cleanLine(priority.name) : "Not resolved"));
    lines.push("- **Audience need:** " + cleanLine(pack.strategy.audienceNeed));
    lines.push("", "### Out of Scope", "");
    addBullets(lines, pack.strategy.outOfScope.map(cleanLine));
    lines.push("", "### Success Criteria", "");
    lines.push("Target ranges are proposals to agree with the client, not forecasts.", "");
    lines.push("| Outcome | Metric | Target range | Baseline | Measurement |");
    lines.push("| --- | --- | --- | --- | --- |");
    pack.strategy.successCriteria.forEach((criterion) => {
      lines.push(
        "| " + markdownCell(criterion.outcome) + " | " + markdownCell(criterion.metric) +
        " | " + markdownCell(criterion.targetRange) + " | " + markdownCell(criterion.baseline) +
        " | " + markdownCell(criterion.measurement) + " |"
      );
    });
    lines.push("");
  }

  lines.push("## Historical Performance", "");
  if (pack.performanceContext.recordCount) {
    lines.push("- **Records:** " + pack.performanceContext.recordCount);
    lines.push("- **Campaigns:** " + pack.performanceContext.campaignCount);
    lines.push("- **Impressions:** " + pack.performanceContext.totals.impressions);
    lines.push("- **Engagement rate:** " + pack.performanceContext.rates.engagementRate.toFixed(2) + "%");
    lines.push("- **Click-through rate:** " + pack.performanceContext.rates.clickThroughRate.toFixed(2) + "%");
    lines.push("- **Conversions:** " + pack.performanceContext.totals.conversions);
    lines.push("");
    lines.push("### Observed Learnings", "");
    addBullets(lines, pack.performanceContext.learnings);
  } else {
    lines.push("No historical performance records were available for this generation.");
  }
  lines.push("");

  lines.push("## Brand Foundation", "");
  lines.push("### Positioning", "", cleanLine(pack.brandContext.positioning), "");
  lines.push("### Voice", "");
  addBullets(lines, pack.brandContext.voice);
  lines.push("", "### Content Goals", "");
  addBullets(lines, pack.brandContext.contentGoals);
  const inferredFields = pack.inferredFields ?? [];
  const assumptions = pack.brandContext.assumptions ?? [];
  if (inferredFields.length || assumptions.length) {
    lines.push("", "### Assumptions to Confirm", "");
    if (inferredFields.length) {
      lines.push("- Inferred from the website rather than supplied: " + inferredFields.join(", ") + ".");
    }
    assumptions.forEach((assumption) => lines.push("- " + cleanLine(assumption)));
  }
  lines.push("");

  const factSheet = pack.factSheet ?? { facts: [], gaps: [], discoverySteps: [] };
  if (factSheet.facts.length || factSheet.discoverySteps.length) {
    const sourceTitle = (sourceId: string) => pack.sources.find((source) => source.id === sourceId)?.title ?? sourceId;
    lines.push("## Brand Fact Sheet", "");
    lines.push("Each fact's quote was checked against the source section it came from.", "");
    for (const category of ["product", "audience", "proof", "pricing", "competitor", "company"] as const) {
      const facts = factSheet.facts.filter((fact) => fact.category === category);
      if (!facts.length) continue;
      lines.push("### " + category[0].toUpperCase() + category.slice(1), "");
      facts.forEach((fact) => {
        lines.push(
          "- " + cleanLine(fact.statement) + (fact.timeSensitive ? " _(time-sensitive)_" : "") +
          " — \"" + cleanLine(fact.quote).slice(0, 240) + "\" (" + cleanLine(sourceTitle(fact.sourceId)) + ", " + fact.authority + ")"
        );
      });
      lines.push("");
    }
    if (factSheet.gaps.length) {
      lines.push("### No Evidence Found", "");
      lines.push("Discovery found no verified fact for: " + factSheet.gaps.join(", ") + ". Supply a source before making claims about these.", "");
    }
    if (factSheet.discoverySteps.length) {
      lines.push("### Follow-up Research", "");
      factSheet.discoverySteps.forEach((step) => {
        lines.push("- **" + cleanLine(step.reason) + " (" + step.method + "):** " + cleanLine(step.target) + " — " + cleanLine(step.outcome));
      });
      lines.push("");
    }
  }

  lines.push("## Content Landscape", "", cleanLine(pack.contentLandscape.summary), "");
  lines.push("### Opportunity Gaps", "");
  if (pack.contentLandscape.opportunityGaps.length) {
    pack.contentLandscape.opportunityGaps.forEach((gap) => {
      lines.push(
        "- **" + cleanLine(gap.name) + " (" + gap.priority + "):** " +
        cleanLine(gap.recommendation)
      );
    });
  } else {
    lines.push("- None recorded.");
  }
  lines.push("");

  lines.push("## Audience Segments", "");
  pack.audienceSegments.forEach((segment) => {
    lines.push("### " + cleanLine(segment.name), "");
    lines.push("- **Awareness:** " + cleanLine(segment.awarenessLevel));
    lines.push("- **Positioning:** " + cleanLine(segment.messagePositioning));
    lines.push("- **Tone:** " + cleanLine(segment.emotionalTone));
    lines.push("- **Primary platform:** " + (segment.primaryPlatform ?? "Not assigned"));
    lines.push("- **CTA:** " + cleanLine(segment.cta));
    lines.push("- **Needs:** " + segment.needs.map(cleanLine).join("; "));
    lines.push("- **Objections:** " + segment.objections.map(cleanLine).join("; "));
    lines.push("");
  });

  lines.push("## Content Territories", "");
  pack.territories.forEach((territory) => {
    lines.push("### " + cleanLine(territory.name), "");
    lines.push(cleanLine(territory.rationale), "");
    lines.push("- **Owned gap:** " + cleanLine(territory.ownedGap));
    lines.push("- **Proof angle:** " + cleanLine(territory.proofAngle));
    lines.push("- **Sample angles:** " + territory.sampleAngles.map(cleanLine).join("; "));
    lines.push("");
  });

  lines.push("## Hook System", "");
  pack.hooks.forEach((hook) => {
    lines.push("- **" + hook.id + " / " + hook.platform + ":** " + cleanLine(hook.text));
    lines.push("  - Hypothesis: " + cleanLine(hook.testHypothesis));
    lines.push("  - Territory: " + cleanLine(hook.contentTerritory));
  });
  lines.push("");

  lines.push("## Content Series", "");
  pack.contentSeries.forEach((series) => {
    lines.push("### " + cleanLine(series.title), "");
    lines.push("- **Territory:** " + cleanLine(series.territory));
    lines.push("- **Target segment:** " + cleanLine(series.targetSegment));
    lines.push("- **Narrative arc:** " + cleanLine(series.narrativeArc));
    lines.push("- **Episodes:** " + series.episodes.map((episode) => cleanLine(episode.title)).join("; "));
    lines.push("");
  });

  lines.push("## Platform Plan", "");
  pack.platformAdaptations.forEach((adaptation) => {
    lines.push("### " + adaptation.platform, "");
    lines.push("- **Role:** " + cleanLine(adaptation.role));
    lines.push("- **Reasoning:** " + cleanLine(adaptation.reasoning));
    lines.push("- **Formats:** " + adaptation.formatPairings.map(cleanLine).join(", "));
    lines.push("- **CTA style:** " + cleanLine(adaptation.ctaStyle));
    lines.push("");
  });

  lines.push("## Editorial System", "");
  lines.push("- **Profile:** " + pack.brief.editorialProfile);
  lines.push("- **Quality score:** " + pack.editorialReport.score + "/100");
  lines.push("- **Gate:** " + (pack.editorialReport.passed ? "Passed" : "Needs review"));
  lines.push("- **Rewrite summary:** " + cleanLine(pack.editorialReport.rewriteSummary));
  pack.editorialMix.forEach((item) => {
    lines.push("- **" + item.mode + " (" + item.percentage + "%):** " + cleanLine(item.rationale));
  });
  lines.push("");

  if ((pack.contentItems ?? []).length) {
    lines.push("## Core Messages", "");
    lines.push("Each core message is defined once and written natively for each platform.", "");
    pack.contentItems.forEach((item) => {
      const renditions = pack.assets.filter((asset) => asset.contentItemId === item.id);
      lines.push("- **" + item.id + ":** " + cleanLine(item.coreMessage));
      lines.push(
        "  - Renditions: " +
        (renditions.length ? renditions.map((asset) => asset.platform + " " + asset.contentFormat).join(", ") : "none drafted")
      );
    });
    lines.push("");
  }

  lines.push("## Publish-Ready Content", "");
  pack.assets.forEach((asset) => {
    lines.push("### " + cleanLine(asset.title), "");
    lines.push("- **Platform:** " + asset.platform);
    lines.push("- **Format:** " + asset.contentFormat);
    lines.push("- **Editorial mode:** " + asset.editorialMode);
    lines.push("- **CTA:** " + cleanLine(asset.cta), "");
    if (asset.contentFormat === "thread" && asset.threadPosts.length) {
      asset.threadPosts.forEach((post, index) => lines.push((index + 1) + ". " + cleanLine(post)));
    } else if (asset.article) {
      lines.push("#### " + cleanLine(asset.article.subtitle), "", asset.article.introduction, "");
      asset.article.sections.forEach((section) => {
        lines.push("#### " + cleanLine(section.heading), "", section.body, "");
      });
      lines.push(asset.article.conclusion, "");
      lines.push("Tags: " + asset.article.tags.map(cleanLine).join(", "));
    } else {
      lines.push(asset.copy);
    }
    const sourceLinks = sourceLinksForAsset(pack, asset);
    if (sourceLinks.length) {
      lines.push("", "#### Sources", "");
      sourceLinks.forEach((source) => {
        lines.push("- [" + source.title + "](" + source.url + ")");
      });
    }
    lines.push("");
  });

  if (pack.brandIdentity) {
    const identity = pack.brandIdentity;
    lines.push("## Brand Identity", "");
    lines.push("Extracted from " + identity.sourceUrl + ".", "");
    if (identity.colors.length) {
      lines.push("- **Colors:** " + identity.colors.map((color) => color.role + " " + color.value).join(", "));
    }
    if (identity.headingFont) lines.push("- **Heading font:** " + cleanLine(identity.headingFont));
    if (identity.bodyFont) lines.push("- **Body font:** " + cleanLine(identity.bodyFont));
    if (identity.colorScheme) lines.push("- **Color scheme:** " + identity.colorScheme);
    if (identity.personality) lines.push("- **Personality:** " + cleanLine(identity.personality));
    if (identity.logoUrl) lines.push("- **Logo:** " + identity.logoUrl);
    lines.push("");
  }

  lines.push("## Visual Plan", "");
  if (pack.visualBriefs.length) {
    pack.visualBriefs.forEach((brief) => {
      lines.push("### " + brief.id + " / " + brief.visualType, "");
      lines.push("- **Asset:** " + brief.assetId);
      lines.push("- **Purpose:** " + cleanLine(brief.purpose));
      lines.push("- **Key message:** " + cleanLine(brief.keyMessage));
      lines.push("- **Aspect ratio:** " + brief.aspectRatio);
      lines.push("- **Alt text:** " + cleanLine(brief.altText));
      lines.push("- **Status:** " + brief.status, "");
    });
  } else {
    lines.push("No visuals planned.", "");
  }

  lines.push("## Campaign Calendar", "");
  lines.push("| Day | Platform | Format | Audience | Territory | Goal |");
  lines.push("| ---: | --- | --- | --- | --- | --- |");
  pack.calendar.forEach((item) => {
    lines.push(
      "| " + item.day +
      " | " + markdownCell(item.platform) +
      " | " + markdownCell(item.format) +
      " | " + markdownCell(item.audienceSegment) +
      " | " + markdownCell(item.territory) +
      " | " + markdownCell(item.goal) + " |"
    );
  });
  lines.push("");

  lines.push("## Proof and Governance", "");
  lines.push("- **Claims checked:** " + pack.proofReport.checkedClaims);
  lines.push("- **Supported:** " + pack.proofReport.supported);
  lines.push("- **Unsupported:** " + pack.proofReport.unsupported);
  lines.push("- **Conflicts:** " + pack.proofReport.conflicts);
  lines.push("- **Time-sensitive:** " + pack.proofReport.timeSensitive);
  lines.push("- **Editorial framing (reviewed for tone, not fact-checked):** " + pack.proofReport.editorial);
  lines.push("- **Repaired:** " + repairedClaims);
  lines.push("");

  const sourcesById = new Map(pack.sources.map((source) => [source.id, source]));
  const evidenced = pack.proofReport.claims.filter((claim) => claim.evidence.length);
  if (evidenced.length) {
    lines.push("### Evidence", "");
    evidenced.forEach((claim) => {
      const [first] = claim.evidence;
      const source = sourcesById.get(first.sourceId);
      const url = source?.url || first.locator;
      const citation = url ? "[" + cleanLine(source?.title ?? url) + "](" + url + ")" : cleanLine(source?.title ?? first.sourceId);
      const section = first.sectionId ? ", section " + first.sectionId : "";
      lines.push(
        "- **" + claim.status + " · " + claim.claimKind + ":** " + cleanLine(claim.text) +
        " — \"" + cleanLine(first.quote).slice(0, 240) + "\" (" + citation + section + ")"
      );
    });
    lines.push("");
  }
  const needsSource = pack.proofReport.claims.filter(
    (claim) => claim.status === "unsupported" && claim.resolutionStatus === "unresolved"
  );
  if (needsSource.length) {
    lines.push("### Needs a Source Before Publishing", "");
    needsSource.forEach((claim) => lines.push("- " + cleanLine(claim.text)));
    lines.push("");
  }

  lines.push("## Production Capacity", "");
  lines.push("- **Total:** " + cleanLine(pack.productionPlan.totalHours));
  lines.push("- **Risk:** " + pack.productionPlan.overloadRisk);
  lines.push("- **Summary:** " + cleanLine(pack.productionPlan.capacitySummary));
  lines.push("");
  pack.productionPlan.steps.forEach((step) => {
    lines.push(
      "- **" + cleanLine(step.day) + ":** " + cleanLine(step.task) +
      " (" + cleanLine(step.estimate) + ", " + cleanLine(step.role) + ")"
    );
  });
  lines.push("");

  return lines.join("\n").trim() + "\n";
}

function csvCell(value: string | number) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

export function buildCalendarCsv(pack: DeliveryPack) {
  const headers = [
    "calendar_item_id",
    "day",
    "platform",
    "format",
    "audience_segment",
    "territory",
    "series_id",
    "episode",
    "hook_id",
    "hook",
    "goal",
    "cta",
    "platform_fit_reason",
    "source_ids",
    "production_task_id"
  ];
  const rows = pack.calendar.map((item) => [
    item.id,
    item.day,
    item.platform,
    item.format,
    item.audienceSegment,
    item.territory,
    item.series,
    item.episode,
    item.hookId,
    item.hook,
    item.goal,
    item.cta,
    item.platformFitReason,
    item.sourcePack.join(" | "),
    item.productionTaskId
  ]);

  return "\uFEFF" + [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n") + "\r\n";
}

// The client-facing projection of a campaign. Fields are listed explicitly so internal reasoning,
// raw source text, and run metadata never reach the client.
export function buildClientContentPack(pack: DeliveryPack) {
  const sourcesById = new Map(pack.sources.map((source) => [source.id, source]));
  return {
    format: "flusso-content-pack",
    version: 3,
    generatedAt: pack.generation.generatedAt,
    brand: {
      name: pack.brief.brand,
      website: pack.brief.website,
      industry: pack.brief.industry,
      audience: pack.brief.audience,
      tone: pack.brief.tone,
      inferredFields: pack.inferredFields ?? []
    },
    campaign: {
      goal: pack.brief.goal,
      platforms: pack.brief.platforms,
      durationDays: pack.brief.durationDays,
      postsPerWeek: pack.brief.postsPerWeek,
      restrictions: pack.brief.restrictions
    },
    strategy: {
      statement: pack.strategy?.statement ?? "",
      prioritySegmentId: pack.strategy?.prioritySegmentId ?? "",
      audienceNeed: pack.strategy?.audienceNeed ?? "",
      outOfScope: pack.strategy?.outOfScope ?? [],
      successCriteria: pack.strategy?.successCriteria ?? [],
      positioning: pack.brandContext.positioning,
      voice: pack.brandContext.voice,
      contentGoals: pack.brandContext.contentGoals,
      prohibitedClaims: pack.brandContext.prohibitedClaims,
      assumptions: pack.brandContext.assumptions ?? [],
      audienceSegments: pack.audienceSegments.map((segment) => ({
        id: segment.id,
        name: segment.name,
        awarenessLevel: segment.awarenessLevel,
        needs: segment.needs,
        objections: segment.objections,
        messagePositioning: segment.messagePositioning,
        cta: segment.cta
      })),
      territories: pack.territories.map((territory) => ({
        id: territory.id,
        name: territory.name,
        rationale: territory.rationale,
        sampleAngles: territory.sampleAngles,
        proofAngle: territory.proofAngle
      })),
      series: pack.contentSeries.map((series) => ({
        id: series.id,
        title: series.title,
        territory: series.territory,
        targetSegment: series.targetSegment,
        narrativeArc: series.narrativeArc
      }))
    },
    factSheet: {
      facts: (pack.factSheet?.facts ?? []).map((fact) => {
        const source = sourcesById.get(fact.sourceId);
        return {
          id: fact.id,
          category: fact.category,
          statement: fact.statement,
          entity: fact.entity,
          quote: fact.quote,
          timeSensitive: fact.timeSensitive,
          authority: fact.authority,
          source: source?.title ?? fact.sourceId,
          url: source?.url ?? null
        };
      }),
      missingEvidence: pack.factSheet?.gaps ?? []
    },
    contentItems: (pack.contentItems ?? []).map((item) => ({
      id: item.id,
      coreMessage: item.coreMessage,
      segmentId: item.segmentId,
      territoryId: item.territoryId,
      factIds: item.factIds,
      assetIds: pack.assets.filter((asset) => asset.contentItemId === item.id).map((asset) => asset.id)
    })),
    calendar: pack.calendar.map((item) => ({
      id: item.id,
      day: item.day,
      platform: item.platform,
      format: item.format,
      audienceSegment: item.audienceSegment,
      territory: item.territory,
      hook: item.hook,
      goal: item.goal,
      cta: item.cta
    })),
    assets: pack.assets.map((asset) => ({
      id: asset.id,
      calendarItemId: asset.calendarItemId,
      contentItemId: asset.contentItemId,
      platform: asset.platform,
      contentFormat: asset.contentFormat,
      title: asset.title,
      copy: asset.copy,
      threadPosts: asset.threadPosts,
      article: asset.article,
      cta: asset.cta,
      visualBriefId: asset.visualBriefId,
      claimIds: asset.linkedClaims
    })),
    visualBriefs: pack.visualBriefs.map((visual) => ({
      id: visual.id,
      assetId: visual.assetId,
      visualType: visual.visualType,
      purpose: visual.purpose,
      keyMessage: visual.keyMessage,
      aspectRatio: visual.aspectRatio,
      altText: visual.altText,
      prompt: visual.prompt,
      status: visual.status
    })),
    brandIdentity: pack.brandIdentity ?? null,
    proof: {
      summary: {
        checkedClaims: pack.proofReport.checkedClaims,
        supported: pack.proofReport.supported,
        unsupported: pack.proofReport.unsupported,
        conflicts: pack.proofReport.conflicts,
        timeSensitive: pack.proofReport.timeSensitive,
        editorial: pack.proofReport.editorial ?? 0
      },
      claims: pack.proofReport.claims.map((claim) => ({
        id: claim.id,
        text: claim.text,
        kind: claim.claimKind,
        status: claim.status,
        confidence: claim.confidence,
        checkedAt: claim.checkedAt,
        usedIn: claim.contentUsedIn,
        recommendation: claim.recommendation,
        evidence: (claim.evidence ?? []).map((item) => {
          const source = sourcesById.get(item.sourceId);
          return {
            quote: item.quote,
            stance: item.stance,
            source: source?.title ?? item.sourceId,
            url: source?.url || item.locator || null
          };
        })
      }))
    },
    sources: pack.sources
      .filter((source) => source.authority !== "internal" && source.sourceType !== "prompt-library")
      .map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url ?? null,
        sourceType: source.sourceType,
        authority: source.authority,
        fetchedAt: source.fetchedAt,
        fetchStatus: source.fetchStatus
      }))
  };
}

export function buildContentPackJson(pack: DeliveryPack) {
  return JSON.stringify(buildClientContentPack(pack), null, 2) + "\n";
}

export function buildCampaignExport(
  pack: DeliveryPack,
  format: CampaignExportFormat
): CampaignExport {
  const baseName = exportBaseName(pack);

  if (format === "strategy") {
    return {
      content: buildStrategyMarkdown(pack),
      contentType: "text/markdown; charset=utf-8",
      filename: baseName + "-strategy.md"
    };
  }

  if (format === "calendar") {
    return {
      content: buildCalendarCsv(pack),
      contentType: "text/csv; charset=utf-8",
      filename: baseName + "-calendar.csv"
    };
  }

  return {
    content: buildContentPackJson(pack),
    contentType: "application/json; charset=utf-8",
    filename: baseName + "-content-pack.json"
  };
}
