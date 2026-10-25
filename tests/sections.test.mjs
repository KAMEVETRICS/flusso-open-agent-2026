import assert from "node:assert/strict";
import test from "node:test";
import { createSectionIndex, plainText, sectionContaining, splitIntoSections } from "../lib/sections.ts";

const docs = {
  id: "src-project-docs",
  extractedText: [
    "Doma is the DomainFi protocol.",
    "",
    "## Protocol overview",
    "Tokenized domains stay **DNS-compliant** and resolve like traditional domains.",
    "",
    "### [Supported chains](https://docs.doma.xyz/chains)",
    "Doma supports Base, Solana, Avalanche, and Ethereum.",
    "",
    "## Empty heading",
    "## Protocol overview",
    "A second section with a repeated heading.",
    "",
    "```",
    "# not a heading inside a code fence",
    "```"
  ].join("\n")
};

test("splits a source at headings with stable, readable IDs", () => {
  const sections = splitIntoSections(docs);
  assert.deepEqual(sections.map((section) => [section.id, section.heading]), [
    ["src-project-docs#intro", ""],
    ["src-project-docs#protocol-overview", "Protocol overview"],
    ["src-project-docs#supported-chains", "Supported chains"],
    ["src-project-docs#protocol-overview-2", "Protocol overview"]
  ]);
  assert.match(sections[3].text, /# not a heading inside a code fence/);
  assert.deepEqual(sections.map((section) => section.position), [1, 2, 3, 4]);
  assert.deepEqual(splitIntoSections(docs), sections, "same text, same sections");
});

test("chunks long sections and headingless text under the size limit", () => {
  const paragraph = "word ".repeat(400).trim();
  const sections = splitIntoSections({ id: "src-long", extractedText: [paragraph, paragraph, paragraph].join("\n\n") });
  assert.equal(sections.length, 3);
  assert.deepEqual(sections.map((section) => section.id), ["src-long#intro", "src-long#intro-2", "src-long#intro-3"]);
  assert.ok(sections.every((section) => section.text.length <= 2500));

  const json = splitIntoSections({ id: "src-json", extractedText: "x".repeat(6000) });
  assert.deepEqual(json.map((section) => section.text.length), [2500, 2500, 1000]);

  const cards = Array.from({ length: 120 }, (_, index) => "card " + index + " Token FDV $1.4K").join("\n");
  const cardSections = splitIntoSections({ id: "src-cards", extractedText: cards });
  assert.ok(cardSections.length > 1);
  assert.ok(cardSections.every((section) => cards.includes(section.text)), "chunks keep the original line breaks");
});

test("drops docs permalink anchors from headings", () => {
  const [section] = splitIntoSections({
    id: "src-docs",
    extractedText: "## Introducing Doma[Direct link to heading](https://docs.doma.xyz/#introducing-doma)\nDoma bridges DNS and onchain trading."
  });
  assert.equal(section.id, "src-docs#introducing-doma");
  assert.equal(section.heading, "Introducing Doma");
});

test("makes plain text for search without images or link targets", () => {
  assert.equal(
    plainText("Live](https://app.doma.xyz/a) [![a.com avatar](https://cdn/x.png)\\\\\nToken **FDV** [docs](https://d)"),
    "Live\nToken FDV docs"
  );
});

test("finds the section that holds a quote", () => {
  const sections = splitIntoSections(docs);
  assert.equal(sectionContaining(sections, "Doma supports Base, Solana, Avalanche, and Ethereum")?.id, "src-project-docs#supported-chains");
  assert.equal(sectionContaining(sections, "Doma supports Bitcoin and Litecoin natively"), undefined);
});

test("ranks sections by lexical relevance to a claim", () => {
  const index = createSectionIndex(splitIntoSections(docs));
  const [best] = index.search("Which chains does Doma support? Solana and Base", 2);
  assert.equal(best.section.id, "src-project-docs#supported-chains");
  assert.deepEqual(index.search("the and of", 3), [], "stopwords alone match nothing");
});
