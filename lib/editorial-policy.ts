import type {
  ContentAsset,
  EditorialMixItem,
  EditorialProfile,
  ProjectBrief
} from "./schemas";

export const EDITORIAL_POLICY = [
  "Write for a real reader with a real decision to make.",
  "Use one primary editorial mode per asset.",
  "Name concrete mechanisms, examples, constraints, tradeoffs, or consequences.",
  "Remove generic openings, empty hype, fake profundity, repetitive contrasts, and conclusions that restate the introduction.",
  "Do not use phrases such as in today's fast-paced world, ever-evolving landscape, game-changing, revolutionary, unlock the power, or seamless unless technically precise.",
  "Never invent customer stories, founder anecdotes, quotations, metrics, partnerships, capabilities, outcomes, or personal experiences.",
  "Preserve factual claims, evidence source IDs, asset IDs, calendar IDs, series IDs, hook IDs, territories, segments, platform, and CTA intent.",
  "For X short posts, make one point and keep the copy within 280 characters.",
  "For X threads, return three to twelve ordered posts, each within 280 characters, with progression and a real conclusion.",
  "For X articles and Medium, return a subtitle, introduction, at least three developed sections, conclusion, and tags.",
  "Publish-ready articles should contain at least 300 words unless the brief explicitly requests a shorter form.",
  "For Medium, always use the article format.",
  "For Instagram, use an image post or a carousel of three to ten slides; the caption leads with the point and stays within 2,200 characters.",
  "For TikTok, write a short-video script: a hook that lands in the first two seconds, three to twelve beats, 15 to 90 seconds, and a caption within 2,200 characters.",
  "Use visuals only when they improve comprehension. Prefer deterministic charts for numeric data and avoid text-heavy generated images."
].join("\n");

const mixes: Record<EditorialProfile, Array<[EditorialMixItem["mode"], number, string]>> = {
  balanced: [
    ["direct-practical", 20, "Keep the campaign useful and immediately legible."],
    ["technical-explainer", 20, "Build authority through mechanisms and tradeoffs."],
    ["point-of-view", 15, "Give the brand a defensible position."],
    ["how-to", 15, "Turn strategy into executable guidance."],
    ["storytelling", 10, "Use real sequences and lessons when evidence exists."],
    ["proof-led", 10, "Connect claims to supplied evidence."],
    ["comparison", 5, "Clarify choices and evaluation criteria."],
    ["community", 5, "Create selective opportunities for response."]
  ],
  "technical-authority": [
    ["technical-explainer", 30, "Lead with mechanisms, architecture, and limitations."],
    ["how-to", 20, "Make technical knowledge executable."],
    ["point-of-view", 15, "Take defensible positions on implementation choices."],
    ["proof-led", 15, "Support authority with evidence."],
    ["direct-practical", 10, "Keep complex ideas accessible."],
    ["comparison", 10, "Explain tradeoffs between approaches."]
  ],
  "founder-led": [
    ["storytelling", 25, "Use real founder or company sequences from supplied sources."],
    ["point-of-view", 25, "Make the founder's perspective distinct."],
    ["direct-practical", 20, "Translate experience into useful lessons."],
    ["technical-explainer", 10, "Explain the product without losing the human voice."],
    ["how-to", 10, "Turn lessons into practical steps."],
    ["proof-led", 5, "Ground the narrative in evidence."],
    ["community", 5, "Invite specific peer responses."]
  ],
  "direct-growth": [
    ["direct-practical", 30, "Lead with useful value and a proportionate action."],
    ["proof-led", 20, "Make conversion claims evidence-led."],
    ["comparison", 15, "Clarify why the offer is preferable."],
    ["how-to", 15, "Show the path from interest to action."],
    ["point-of-view", 10, "Create differentiated demand."],
    ["technical-explainer", 5, "Answer implementation objections."],
    ["community", 5, "Use selective conversation prompts."]
  ]
};

export function editorialMixFor(profile: EditorialProfile): EditorialMixItem[] {
  return mixes[profile].map(([mode, percentage, rationale]) => ({
    mode,
    percentage,
    rationale
  }));
}

type DraftLineage = { id: string; calendarItemId: string };

// Models sometimes rename, drop, or add assets while rewriting. Match each candidate to a draft by
// exact ID first, then by its preserved calendar item (unique per draft); unmatched extras are dropped.
export function matchAssetsToDrafts<T extends DraftLineage, D extends DraftLineage>(
  candidates: T[],
  drafts: D[]
): { matched: T[]; renamed: Map<string, string>; missing: D[] } {
  const unclaimed = new Map(drafts.map((draft) => [draft.id, draft]));
  const renamed = new Map<string, string>();
  const matched: T[] = [];
  const leftovers: T[] = [];

  for (const candidate of candidates) {
    if (unclaimed.has(candidate.id)) {
      unclaimed.delete(candidate.id);
      matched.push(candidate);
    } else {
      leftovers.push(candidate);
    }
  }

  for (const candidate of leftovers) {
    const draft = Array.from(unclaimed.values()).find(
      (item) => item.calendarItemId !== "" && item.calendarItemId === candidate.calendarItemId
    );
    if (!draft) continue;
    unclaimed.delete(draft.id);
    renamed.set(candidate.id, draft.id);
    matched.push({ ...candidate, id: draft.id });
  }

  return { matched, renamed, missing: Array.from(unclaimed.values()) };
}

// Hooks this similar (Jaccard overlap of their words) read as the same hook to an audience.
const REPEATED_HOOK_SIMILARITY = 0.6;

function hookTokens(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1)
  );
}

export function hookSimilarity(left: string, right: string) {
  const a = hookTokens(left);
  const b = hookTokens(right);
  if (!a.size || !b.size) return 0;
  const shared = Array.from(a).filter((token) => b.has(token)).length;
  return shared / (a.size + b.size - shared);
}

// Items whose hook repeats an earlier one. Of each repeated pair, the item not in `keep`
// (for example, one with a drafted asset) is the one returned for rewriting.
export function findRepeatedHooks(items: Array<{ id: string; hook: string }>, keep: Set<string> = new Set()) {
  const rewrite = new Set<string>();
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) {
      const a = items[left];
      const b = items[right];
      if (rewrite.has(a.id) || rewrite.has(b.id)) continue;
      if (hookSimilarity(a.hook, b.hook) < REPEATED_HOOK_SIMILARITY) continue;
      if (!keep.has(b.id)) rewrite.add(b.id);
      else if (!keep.has(a.id)) rewrite.add(a.id);
    }
  }
  return Array.from(rewrite);
}

const internalNotePatterns: Array<[RegExp, string]> = [
  [/\b(?:working assumptions?|should be (?:validated|confirmed)|to be (?:validated|confirmed)|needs? (?:verification|validation)|validate (?:this )?with the (?:brand|client|team))\b/i, "an internal caveat"],
  [/\b(?:TODO|TBD|FIXME)\b|lorem ipsum/i, "a placeholder marker"],
  [/\[(?:insert|placeholder|brand|todo|tbd|link|source|citation)[^\]]*\]/i, "a bracketed placeholder"],
  [/(?:^|\n)\s*(?:internal note|editor'?s note|note to (?:self|editor|client))\s*:/i, "an editor's note"],
  [/\b(?:src|asset|claim|cal|hook|series|territory|visual|segment)-\d+\b/, "an internal ID"]
];

// Signs that internal working text leaked into client-facing copy.
export function findInternalNotes(text: string) {
  return internalNotePatterns.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

export type EditorialIssue = {
  assetId: string;
  code:
    | "slop"
    | "internal-note"
    | "short-post-length"
    | "thread-structure"
    | "thread-post-length"
    | "article-structure"
    | "article-depth"
    | "medium-format"
    | "format-mix"
    | "duplicate-opening"
    | "instagram-format"
    | "carousel-structure"
    | "tiktok-format"
    | "video-script"
    | "video-duration"
    | "caption-length"
    | "visual-required";
  message: string;
};

const slopPatterns: Array<[RegExp, string]> = [
  [/\bin today'?s fast[- ]paced world\b/i, "generic fast-paced-world opening"],
  [/\bever[- ]evolving landscape\b/i, "generic ever-evolving-landscape phrase"],
  [/\bgame[- ]chang(?:er|ing)\b/i, "unsupported game-changing language"],
  [/\brevolution(?:ary|ize|izing)\b/i, "unsupported revolutionary language"],
  [/\bunlock the power\b/i, "generic unlock-the-power phrase"],
  [/\bdelve into\b/i, "generic delve-into phrasing"],
  [/\bnot just\b[\s\S]{0,100}\bbut\b/i, "formulaic not-just-but contrast"]
];

function assetText(asset: ContentAsset) {
  return [
    asset.title,
    asset.copy,
    ...asset.threadPosts,
    asset.article?.subtitle ?? "",
    asset.article?.introduction ?? "",
    ...(asset.article?.sections.flatMap((section) => [section.heading, section.body]) ?? []),
    asset.article?.conclusion ?? "",
    ...asset.slides.flatMap((slide) => [slide.headline, slide.body]),
    asset.videoScript?.hook ?? "",
    ...(asset.videoScript?.beats.flatMap((beat) => [beat.voiceover, beat.onScreenText]) ?? [])
  ].join("\n");
}

function normalizedOpening(asset: ContentAsset) {
  return assetText(asset)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 10)
    .join(" ");
}

function articleWordCount(asset: ContentAsset) {
  if (!asset.article) return 0;
  return [
    asset.article.subtitle,
    asset.article.introduction,
    ...asset.article.sections.flatMap((section) => [section.heading, section.body]),
    asset.article.conclusion
  ]
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

const MAX_SOCIAL_CAPTION_CHARS = 2200;

// Instagram and TikTok rules: the right format, a complete carousel or script, a caption within the
// platform limit, and a visual for every post.
function visualPlatformIssues(asset: ContentAsset): EditorialIssue[] {
  const issues: EditorialIssue[] = [];
  const add = (code: EditorialIssue["code"], message: string) => issues.push({ assetId: asset.id, code, message });
  if (asset.platform === "Instagram") {
    if (asset.contentFormat !== "image-post" && asset.contentFormat !== "carousel") {
      add("instagram-format", "Instagram assets must be an image-post or a carousel.");
    }
    if (asset.contentFormat === "carousel" && (
      asset.slides.length < 3 || asset.slides.length > 10 ||
      asset.slides.some((slide) => !slide.headline.trim() && !slide.body.trim())
    )) {
      add("carousel-structure", "An Instagram carousel needs three to ten nonempty slides.");
    }
  }
  if (asset.platform === "TikTok") {
    const script = asset.videoScript;
    if (asset.contentFormat !== "short-video") add("tiktok-format", "TikTok assets must use the short-video format.");
    if (!script || !script.hook.trim() || script.beats.length < 3 || script.beats.length > 12) {
      add("video-script", "A TikTok script needs a hook and three to twelve beats.");
    } else if (script.durationSeconds < 15 || script.durationSeconds > 90) {
      add("video-duration", "A TikTok script should run 15 to 90 seconds.");
    }
  }
  if (asset.platform === "Instagram" || asset.platform === "TikTok") {
    if (asset.copy.length > MAX_SOCIAL_CAPTION_CHARS) {
      add("caption-length", asset.platform + " caption exceeds " + MAX_SOCIAL_CAPTION_CHARS + " characters.");
    }
    if (!asset.visualBriefId) add("visual-required", asset.platform + " assets need a visual brief.");
  }
  return issues;
}

export function inspectEditorialAssets(
  assets: ContentAsset[],
  brief: ProjectBrief
): EditorialIssue[] {
  const issues: EditorialIssue[] = [];

  for (const asset of assets) {
    const text = assetText(asset);
    for (const [pattern, label] of slopPatterns) {
      if (pattern.test(text)) {
        issues.push({ assetId: asset.id, code: "slop", message: "Remove " + label + "." });
      }
    }
    for (const label of findInternalNotes(text + "\n" + asset.cta)) {
      issues.push({ assetId: asset.id, code: "internal-note", message: "Remove " + label + " from client-facing copy." });
    }

    if (asset.platform === "X" && asset.contentFormat === "short-post" && asset.copy.length > 280) {
      issues.push({
        assetId: asset.id,
        code: "short-post-length",
        message: "X short post exceeds 280 characters."
      });
    }

    if (asset.platform === "X" && asset.contentFormat === "thread") {
      if (asset.threadPosts.length < 3 || asset.threadPosts.length > 12) {
        issues.push({
          assetId: asset.id,
          code: "thread-structure",
          message: "X thread must contain three to twelve posts."
        });
      }
      if (asset.threadPosts.some((post) => !post.trim() || post.length > 280)) {
        issues.push({
          assetId: asset.id,
          code: "thread-post-length",
          message: "Every X thread post must be nonempty and at most 280 characters."
        });
      }
    }

    if (asset.contentFormat === "article") {
      if (
        !asset.article ||
        !asset.article.subtitle.trim() ||
        !asset.article.introduction.trim() ||
        asset.article.sections.length < 3 ||
        asset.article.sections.some((section) => !section.heading.trim() || !section.body.trim()) ||
        !asset.article.conclusion.trim()
      ) {
        issues.push({
          assetId: asset.id,
          code: "article-structure",
          message: "Article requires a subtitle, introduction, at least three developed sections, and conclusion."
        });
      } else if (articleWordCount(asset) < 300) {
        issues.push({
          assetId: asset.id,
          code: "article-depth",
          message: "Publish-ready article must contain at least 300 words."
        });
      }
    }

    issues.push(...visualPlatformIssues(asset));

    if (asset.platform === "Medium" && asset.contentFormat !== "article") {
      issues.push({
        assetId: asset.id,
        code: "medium-format",
        message: "Medium assets must use the article format."
      });
    }
  }

  const xAssets = assets.filter((asset) => asset.platform === "X");
  if (brief.platforms.includes("X") && xAssets.length >= 3) {
    for (const format of ["short-post", "thread", "article"] as const) {
      if (!xAssets.some((asset) => asset.contentFormat === format)) {
        issues.push({
          assetId: "campaign",
          code: "format-mix",
          message: "X output must include at least one " + format + " when three or more X assets are produced."
        });
      }
    }
  }

  const openingOwners = new Map<string, string>();
  for (const asset of assets) {
    const opening = normalizedOpening(asset);
    if (!opening) continue;
    const existing = openingOwners.get(opening);
    if (existing) {
      issues.push({
        assetId: asset.id,
        code: "duplicate-opening",
        message: "Opening duplicates " + existing + "."
      });
    } else {
      openingOwners.set(opening, asset.id);
    }
  }

  return issues;
}
