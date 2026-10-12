/* global URL */
import type { BrandIdentity } from "./schemas";
import { asRecord, asText } from "./json-values";

// Semantic UI colors (success, warning, error) are left out: they are not brand colors.
const COLOR_ROLES = ["primary", "secondary", "accent", "background", "textPrimary", "textSecondary", "link"];
const COLOR_VALUE = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;
const MAX_FONTS = 4;

function fontName(value: string) {
  return value.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

function httpUrl(value: string, base: string) {
  if (!value) return "";
  try {
    const url = new URL(value, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

export function normalizeBranding(raw: unknown, sourceUrl: string): BrandIdentity | null {
  const branding = asRecord(raw);

  const palette = asRecord(branding.colors);
  const seenColors = new Set<string>();
  const colors: BrandIdentity["colors"] = [];
  for (const role of COLOR_ROLES) {
    const value = asText(palette[role]);
    const key = value.toLowerCase();
    if (!COLOR_VALUE.test(value) || seenColors.has(key)) continue;
    seenColors.add(key);
    colors.push({ role, value });
  }

  const families = asRecord(asRecord(branding.typography).fontFamilies);
  const headingFamily = fontName(asText(families.heading));
  const bodyFamily = fontName(asText(families.primary));
  const listedFonts = Array.isArray(branding.fonts)
    ? branding.fonts.map((font) => fontName(typeof font === "string" ? font : asText(asRecord(font).family)))
    : [];
  const fonts = Array.from(new Set([headingFamily, bodyFamily, ...listedFonts].filter(Boolean))).slice(0, MAX_FONTS);

  const logoUrl = httpUrl(asText(branding.logo) || asText(asRecord(branding.images).logo), sourceUrl);
  const personality = asRecord(branding.personality);
  const scheme = branding.colorScheme;
  const colorScheme = scheme === "dark" || scheme === "light" ? scheme : null;

  if (!colors.length && !fonts.length && !logoUrl) return null;

  return {
    sourceUrl,
    colorScheme,
    colors,
    headingFont: headingFamily || fonts[0] || "",
    bodyFont: bodyFamily || fonts[1] || fonts[0] || "",
    fonts,
    logoUrl,
    personality: [asText(personality.tone), asText(personality.energy)].filter(Boolean).join(", ")
  };
}
