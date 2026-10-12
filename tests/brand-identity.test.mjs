import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBranding } from "../lib/brand-identity.ts";

test("keeps brand colors, fonts, logo, and personality from a Firecrawl profile", () => {
  const identity = normalizeBranding({
    colorScheme: "dark",
    logo: "/assets/logo.svg",
    colors: {
      primary: "#FF6B35",
      secondary: "rgb(20, 20, 20)",
      accent: "#ff6b35",
      background: "url(javascript:alert(1))",
      textPrimary: "#FFF",
      success: "#16A34A"
    },
    fonts: [{ family: "Inter" }, { family: "\"Space Grotesk\", sans-serif" }, "Inter"],
    typography: { fontFamilies: { heading: "'Space Grotesk', system-ui", primary: "Inter, sans-serif" } },
    personality: { tone: "confident", energy: ["high", "ignored"] }
  }, "https://arc.house/");

  assert.deepEqual(identity, {
    sourceUrl: "https://arc.house/",
    colorScheme: "dark",
    colors: [
      { role: "primary", value: "#FF6B35" },
      { role: "secondary", value: "rgb(20, 20, 20)" },
      { role: "textPrimary", value: "#FFF" }
    ],
    headingFont: "Space Grotesk",
    bodyFont: "Inter",
    fonts: ["Space Grotesk", "Inter"],
    logoUrl: "https://arc.house/assets/logo.svg",
    personality: "confident, high"
  });
});

test("falls back to listed fonts and image logos", () => {
  const identity = normalizeBranding({
    fonts: [{ family: "Lora" }, { family: "Work Sans" }],
    images: { logo: "https://cdn.arc.house/logo.png" }
  }, "https://arc.house");

  assert.equal(identity.headingFont, "Lora");
  assert.equal(identity.bodyFont, "Work Sans");
  assert.equal(identity.logoUrl, "https://cdn.arc.house/logo.png");
  assert.equal(identity.colorScheme, null);
});

test("rejects non-http logos and returns null when nothing usable remains", () => {
  assert.equal(normalizeBranding({ logo: "data:image/svg+xml;base64,AAAA" }, "https://arc.house"), null);
  assert.equal(normalizeBranding(null, "https://arc.house"), null);
  assert.equal(normalizeBranding({ colors: { primary: "blue" } }, "https://arc.house"), null);
});
