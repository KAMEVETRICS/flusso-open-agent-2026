/* global AbortSignal */
import process from "node:process";
import type { DeliveryPack, VisualBrief } from "./schemas";
import { asRecord, asText } from "./json-values";
import { OPENROUTER_BASE_URL, appHeaders, imageModel, openRouterApiKey } from "./openrouter";

export type GeneratedVisualImage = {
  base64: string;
  mimeType: string;
  model: string;
};

// 4:5 is not offered by every image model; 3:4 is the nearest widely supported portrait ratio.
const aspectRatios: Record<VisualBrief["aspectRatio"], string> = {
  "1:1": "1:1",
  "16:9": "16:9",
  "4:5": "3:4"
};

function imagePrompt(pack: DeliveryPack, brief: VisualBrief) {
  const evidence = brief.sourceIds
    .map((sourceId) => pack.sources.find((item) => item.id === sourceId))
    .filter((source) => source !== undefined)
    .map((source) => source.title + ": " + source.extractedText.slice(0, 600).replace(/\s+/g, " "));
  const identity = pack.brandIdentity;

  return [
    "Create one polished editorial " + brief.visualType.replace(/-/g, " ") + " for " + pack.brief.brand + " (" + pack.brief.industry + ").",
    "Purpose: " + brief.purpose,
    "Key message: " + brief.keyMessage,
    "Art direction: " + brief.prompt,
    brief.dataPoints.length ? "Represent only these data points, faithfully: " + brief.dataPoints.join("; ") : "",
    evidence.length ? "Supporting facts (use only these): " + evidence.join(" | ") : "",
    identity?.colors.length
      ? "Use this brand palette as the dominant colors: " + identity.colors.map((color) => color.role + " " + color.value).join(", ") + "."
      : "",
    identity?.headingFont ? "Echo the mood of the " + identity.headingFont + " typeface in any typography." : "",
    identity?.colorScheme ? "Overall scheme: " + identity.colorScheme + "." : "",
    "Prioritize explanatory clarity over decoration. Keep typography sparse and legible.",
    "Do not invent metrics, labels, logos, product interfaces, partnerships, or capabilities.",
    "Do not draw logos, wordmarks, or trademarked marks. No watermark. Do not imitate a named living artist."
  ].filter(Boolean).join("\n");
}

export async function generateVisualImage(
  pack: DeliveryPack,
  brief: VisualBrief
): Promise<GeneratedVisualImage> {
  const model = imageModel();
  const response = await fetch(OPENROUTER_BASE_URL + "/images", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + openRouterApiKey(),
      "Content-Type": "application/json",
      ...appHeaders()
    },
    body: JSON.stringify({
      model,
      prompt: imagePrompt(pack, brief),
      aspect_ratio: aspectRatios[brief.aspectRatio]
    }),
    signal: AbortSignal.timeout(Number(process.env.OPENROUTER_IMAGE_TIMEOUT_MS || 180000))
  });

  let payload = {};
  try {
    payload = JSON.parse(await response.text());
  } catch {
    // Non-JSON error bodies fall through to the status-based message.
  }
  const body = asRecord(payload);
  if (!response.ok) {
    const detail = asText(asRecord(body.error).message) || asText(body.error) || "HTTP " + response.status;
    throw new Error("Image generation failed: " + detail);
  }

  const image = asRecord(Array.isArray(body.data) ? body.data[0] : null);
  const base64 = asText(image.b64_json);
  if (!base64) throw new Error("Image generation returned no image.");

  return {
    base64,
    mimeType: asText(image.media_type) || "image/png",
    model
  };
}
