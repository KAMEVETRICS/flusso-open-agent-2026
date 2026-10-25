import type { SourceDocument } from "./schemas";
import { excerptAppearsIn, normalizeForMatch } from "./text-match";

// A heading-delimited passage of a source. IDs are derived from the text, so the same source
// always yields the same sections and a claim can cite one as "src-project-docs#protocol".
export type SourceSection = {
  id: string;
  sourceId: string;
  heading: string;
  text: string;
  position: number;
};

const MAX_SECTION_CHARS = 2500;
const HEADING_LINE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_LINE = /^\s*(```|~~~)/;

// Docs sites append permalink anchors to headings, such as "[Direct link to heading](#intro)".
const PERMALINK = /\[(?:direct link to [^\]]*|permalink[^\]]*|link to this (?:heading|section)|#|¶|\s*|​)\]\([^)]*\)/gi;

function cleanHeading(value: string) {
  return value
    .replace(PERMALINK, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "section";
}

// Packs paragraphs into chunks under the limit; oversized paragraphs fall back to lines, then
// slices. Pieces keep their original separators, so a chunk is always a substring of the body.
function chunkBody(body: string): string[] {
  const chunks: string[] = [];
  let current = "";
  const add = (piece: string, separator: string) => {
    if (current && current.length + separator.length + piece.length > MAX_SECTION_CHARS) {
      chunks.push(current);
      current = "";
    }
    current = current ? current + separator + piece : piece;
  };

  for (const paragraph of body.split(/\n[ \t]*\n/)) {
    if (!paragraph.trim()) continue;
    if (paragraph.length <= MAX_SECTION_CHARS) {
      add(paragraph, "\n\n");
      continue;
    }
    paragraph.split("\n").forEach((line, lineIndex) => {
      for (let start = 0; start < Math.max(line.length, 1); start += MAX_SECTION_CHARS) {
        add(line.slice(start, start + MAX_SECTION_CHARS), start ? "" : lineIndex ? "\n" : "\n\n");
      }
    });
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

export function splitIntoSections(source: Pick<SourceDocument, "id" | "extractedText">): SourceSection[] {
  const raw: Array<{ heading: string; lines: string[] }> = [{ heading: "", lines: [] }];
  let inFence = false;
  for (const line of source.extractedText.split("\n")) {
    if (FENCE_LINE.test(line)) inFence = !inFence;
    const heading = inFence ? null : HEADING_LINE.exec(line);
    if (heading) raw.push({ heading: cleanHeading(heading[2]), lines: [] });
    else raw[raw.length - 1].lines.push(line);
  }

  const slugCounts = new Map<string, number>();
  const sections: SourceSection[] = [];
  for (const block of raw) {
    for (const text of chunkBody(block.lines.join("\n").trim())) {
      const base = block.heading ? slugify(block.heading) : "intro";
      const count = (slugCounts.get(base) ?? 0) + 1;
      slugCounts.set(base, count);
      sections.push({
        id: source.id + "#" + (count === 1 ? base : base + "-" + count),
        sourceId: source.id,
        heading: block.heading,
        text: text.trim(),
        position: sections.length + 1
      });
    }
  }
  return sections;
}

// Readable text for search and snippets: images and link targets removed, link labels kept.
// Evidence quotes are always checked against the original section text.
export function plainText(markdown: string) {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Links cut at a chunk edge leave a bare target or bracket behind.
    .replace(/\]\([^)]*\)/g, " ")
    .replace(/[[\]*_`\\]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function sectionContaining(sections: SourceSection[], quote: string) {
  return sections.find((section) => excerptAppearsIn(quote, section.text));
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "for", "from", "has", "have", "in", "into", "is",
  "it", "its", "of", "on", "or", "that", "the", "their", "this", "to", "was", "were", "will", "with", "you", "your"
]);

export function searchTokens(value: string) {
  return normalizeForMatch(value)
    .replace(/https?:\/\/\S+/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;

// Lexical BM25 over one campaign's sections; small enough to rebuild per run.
export function createSectionIndex(sections: SourceSection[]) {
  const documents = sections.map((section) => {
    const tokens = searchTokens(section.heading + " " + section.text);
    const frequencies = new Map<string, number>();
    for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    return { section, length: tokens.length, frequencies };
  });
  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / Math.max(1, documents.length);
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    for (const token of document.frequencies.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  return {
    search(query: string, limit: number) {
      const terms = Array.from(new Set(searchTokens(query)));
      return documents
        .map((document) => {
          let score = 0;
          for (const term of terms) {
            const frequency = document.frequencies.get(term);
            if (!frequency) continue;
            const containing = documentFrequency.get(term) ?? 0;
            const idf = Math.log(1 + (documents.length - containing + 0.5) / (containing + 0.5));
            score += idf * (frequency * (BM25_K1 + 1)) /
              (frequency + BM25_K1 * (1 - BM25_B + BM25_B * (document.length / averageLength)));
          }
          return { section: document.section, score };
        })
        .filter((result) => result.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, limit);
    }
  };
}
