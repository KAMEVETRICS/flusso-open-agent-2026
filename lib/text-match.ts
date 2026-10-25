const MIN_EXCERPT_CHARS = 20;

// Reduces markdown and typography differences so a copied quote matches its page text.
export function normalizeForMatch(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "\"")
    .replace(/[–—]/g, "-")
    .replace(/[*_`#>|\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// App screens and tables often lose the space between cells ("$750KPotential2.4x"), so the
// final comparison ignores whitespace.
function withoutWhitespace(value: string) {
  return value.replace(/\s/g, "");
}

export function excerptAppearsIn(excerpt: string, text: string) {
  const needle = normalizeForMatch(excerpt);
  return needle.length >= MIN_EXCERPT_CHARS && withoutWhitespace(normalizeForMatch(text)).includes(withoutWhitespace(needle));
}
