import process from "node:process";
import OpenAI from "openai";
import type { DeliveryPack, VisualBrief } from "./schemas";

export type GeneratedVisualImage = {
  base64: string;
  mimeType: "image/webp";
  model: string;
};

function imageSize(aspectRatio: VisualBrief["aspectRatio"]) {
  if (aspectRatio === "16:9") return "1536x1024";
  if (aspectRatio === "4:5") return "1024x1536";
  return "1024x1024";
}

export async function generateVisualImage(
  pack: DeliveryPack,
  brief: VisualBrief
): Promise<GeneratedVisualImage> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing. Add it to .env.local and restart the server.");

  const model = process.env.OPENAI_MODEL || "gpt-5.6-luna";
  const imageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const client = new OpenAI({
    apiKey,
    timeout: Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || 180000)
  });
  const evidence = brief.sourceIds.map((sourceId) => {
    const source = pack.sources.find((item) => item.id === sourceId);
    return source ? {
      id: source.id,
      title: source.title,
      excerpt: source.extractedText.slice(0, 1600)
    } : { id: sourceId, title: "Unresolved source", excerpt: "" };
  });

  const response = await client.responses.create({
    model,
    instructions: [
      "Create exactly one polished editorial visual for the supplied content asset.",
      "Use only supplied facts and data. Do not invent metrics, labels, logos, product interfaces, partnerships, or capabilities.",
      "Prioritize explanatory clarity over decoration. Keep typography sparse and legible.",
      "Do not add a watermark. Do not imitate a named living artist.",
      "For charts and comparisons, faithfully represent only the supplied data points.",
      "When brandIdentity is supplied, use its colors as the dominant palette and echo the mood of its typography. Do not draw logos, wordmarks, or trademarked marks."
    ].join("\n"),
    input: JSON.stringify({
      brand: pack.brief.brand,
      industry: pack.brief.industry,
      brandIdentity: pack.brandIdentity
        ? {
            colorScheme: pack.brandIdentity.colorScheme,
            colors: pack.brandIdentity.colors,
            headingFont: pack.brandIdentity.headingFont,
            bodyFont: pack.brandIdentity.bodyFont,
            personality: pack.brandIdentity.personality
          }
        : null,
      visualBrief: brief,
      evidence
    }),
    tools: [{
      type: "image_generation",
      model: imageModel,
      quality: "medium",
      output_format: "webp",
      size: imageSize(brief.aspectRatio)
    }]
  });

  const imageCall = response.output.find((item) => item.type === "image_generation_call");
  if (!imageCall || !imageCall.result) {
    throw new Error("OpenAI returned no generated image.");
  }

  return {
    base64: imageCall.result,
    mimeType: "image/webp",
    model: imageModel
  };
}