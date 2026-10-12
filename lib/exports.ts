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
  lines.push("");

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
  lines.push("- **Repaired:** " + repairedClaims);
  lines.push("");

  const sourcesById = new Map(pack.sources.map((source) => [source.id, source]));
  const webClaims = pack.proofReport.claims.filter((claim) => claim.sourceType === "web-search");
  if (webClaims.length) {
    lines.push("### Web Evidence", "");
    webClaims.forEach((claim) => {
      const source = claim.sourceId ? sourcesById.get(claim.sourceId) : undefined;
      const citation = source?.url ? "[" + cleanLine(source.title) + "](" + source.url + ")" : "source unavailable";
      lines.push("- **" + claim.status + ":** " + cleanLine(claim.text) + " (" + citation + ")");
    });
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

  lines.push("## Generation Lineage", "");
  pack.generationStages.forEach((stage) => {
    lines.push(
      "- **" + stage.label + ":** " + stage.status +
      " in " + stage.durationMs + " ms; outputs: " + stage.outputKeys.join(", ")
    );
  });
  lines.push("");
  lines.push("### Prompt Routes", "");
  pack.promptRoutes.forEach((route) => {
    lines.push(
      "- **" + cleanLine(route.pipelineStage) + ":** " +
      cleanLine(route.selectedPromptName) + " (score " + route.matchScore + ")"
    );
  });

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

export function buildContentPackJson(pack: DeliveryPack) {
  return JSON.stringify(pack, null, 2) + "\n";
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
