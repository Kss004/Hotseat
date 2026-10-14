export function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, " ").trim().toLowerCase();
}

export function filterValidQuotes(quotes: string[], userTurnTexts: string[]): string[] {
  const allUserText = userTurnTexts.map(normalizeWhitespace).join(" ");
  return quotes.filter((q) => {
    const normQ = normalizeWhitespace(q);
    return normQ.length >= 4 && allUserText.includes(normQ);
  });
}
