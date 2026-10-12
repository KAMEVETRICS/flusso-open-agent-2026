import assert from "node:assert/strict";
import test from "node:test";
import {
  competitorSearchQuery,
  mergeInferredBrief,
  missingBriefFields,
  normalizeWebsite,
  pickKeyPages,
  splitSourceUrls
} from "../lib/discovery-helpers.ts";

const input = {
  website: "https://www.arc.house",
  goal: "Drive qualified sign-ups",
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

const inference = {
  brand: "Arc House",
  industry: "Stablecoin infrastructure",
  audience: "Teams building payment apps",
  tone: "Plain, technical, calm",
  competitors: ["Circle", "arc house", "Bridge", "circle", " "]
};

test("adds https to bare domains and keeps explicit schemes", () => {
  assert.equal(normalizeWebsite(" arc.house "), "https://arc.house");
  assert.equal(normalizeWebsite("http://arc.house"), "http://arc.house");
  assert.equal(normalizeWebsite(""), "");
});

test("splits only http(s) URLs out of free-text docs", () => {
  assert.deepEqual(
    splitSourceUrls("https://docs.arc.house, notes ftp://x.y\nhttp://arc.house/spec"),
    ["https://docs.arc.house", "http://arc.house/spec"]
  );
});

test("builds the competitor query from the bare host", () => {
  assert.equal(competitorSearchQuery("https://www.arc.house/pricing"), "arc.house competitors and alternatives");
});

test("picks one same-site key page per group in priority order", () => {
  const pages = pickKeyPages([
    "https://www.arc.house/",
    "https://arc.house/pricing",
    "https://arc.house/de/about",
    "https://www.arc.house/about/",
    "https://arc.house/products/payments",
    "https://arc.house/product",
    "https://blog.arc.house/about",
    "https://other.com/about",
    "https://arc.house/logo.svg",
    "https://arc.house/careers",
    "not a url"
  ], "https://www.arc.house", 3);

  assert.deepEqual(pages, [
    "https://www.arc.house/about",
    "https://arc.house/product",
    "https://arc.house/pricing"
  ]);
});

test("reports only blank inferable fields as missing", () => {
  assert.deepEqual(missingBriefFields(input), ["brand", "industry", "audience", "tone"]);
  assert.deepEqual(missingBriefFields({ ...input, brand: "Arc", tone: "Calm" }), ["industry", "audience"]);
});

test("fills blanks from inference and records which fields were inferred", () => {
  const { brief, inferredFields } = mergeInferredBrief(input, inference);
  assert.equal(brief.brand, "Arc House");
  assert.equal(brief.audience, "Teams building payment apps");
  assert.deepEqual(brief.competitors, ["Circle", "Bridge"]);
  assert.deepEqual(inferredFields, ["brand", "industry", "audience", "tone", "competitors"]);
  assert.equal(brief.goal, input.goal);
});

test("never overrides values the user stated", () => {
  const stated = { ...input, brand: "Arc", tone: "Warm", competitors: ["Stripe"] };
  const { brief, inferredFields } = mergeInferredBrief(stated, inference);
  assert.equal(brief.brand, "Arc");
  assert.equal(brief.tone, "Warm");
  assert.deepEqual(brief.competitors, ["Stripe"]);
  assert.deepEqual(inferredFields, ["industry", "audience"]);
});

test("leaves fields blank when nothing was inferred", () => {
  const { brief, inferredFields } = mergeInferredBrief(input, null);
  assert.equal(brief.brand, "");
  assert.deepEqual(brief.competitors, []);
  assert.deepEqual(inferredFields, []);
});
