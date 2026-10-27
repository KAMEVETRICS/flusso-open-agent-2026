import { NextResponse } from "next/server";
import { firecrawlParse } from "@/lib/firecrawl";

export const maxDuration = 180;

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;
const ACCEPTED = /\.(pdf|docx?|pptx?|odt|odp|rtf|xlsx?|csv|html?|epub)$/i;

// Turns one uploaded file into text the next campaign can use as a user-supplied source.
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach a file." }, { status: 400 });
    if (!ACCEPTED.test(file.name)) {
      return NextResponse.json({ error: "Upload a PDF, Word, PowerPoint, spreadsheet, or HTML file." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Files must be 20 MB or smaller." }, { status: 400 });

    const parsed = await firecrawlParse(file, file.name);
    const text = parsed.markdown.trim();
    if (!text) return NextResponse.json({ error: "No readable text was found in that file." }, { status: 422 });
    return NextResponse.json({
      title: (parsed.title || file.name).slice(0, 200),
      text: text.slice(0, MAX_TEXT_CHARS),
      truncated: text.length > MAX_TEXT_CHARS,
      words: text.split(/\s+/).filter(Boolean).length
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read that file.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
