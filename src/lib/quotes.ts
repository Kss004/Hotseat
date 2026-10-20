export function normalizeWhitespace(str: string): string {
  return str
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Strips wrapping quote marks and trailing ellipses an LLM tends to add around a quote. */
function stripQuoteDecoration(str: string): string {
  return str.replace(/^["'\s]+|["'\s.…]+$/g, "");
}

/**
 * Keeps only quotes that appear verbatim (whitespace/case/smart-punctuation normalized) inside a SINGLE user turn.
 * Quotes spanning two turns, or invented ones, are dropped.
 */
export function filterValidQuotes(quotes: string[], userTurnTexts: string[]): string[] {
  const normalizedTurns = userTurnTexts.map(normalizeWhitespace);
  const seen = new Set<string>();
  return quotes.filter((q) => {
    const normQ = stripQuoteDecoration(normalizeWhitespace(q));
    if (normQ.length < 4 || seen.has(normQ)) return false;
    const found = normalizedTurns.some((turn) => turn.includes(normQ));
    if (found) seen.add(normQ);
    return found;
  });
}
