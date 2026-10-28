export interface ParsedTurn {
  role: "user" | "assistant";
  content: string;
}

const LINE = /^\s*(assistant|user|agent|bot|human|customer)\s*:\s?(.*)$/i;

function toRole(label: string): ParsedTurn["role"] {
  const l = label.toLowerCase();
  // Bolna's agent is the buyer persona ("assistant"); the person who picked up is the rep ("user")
  return l === "assistant" || l === "agent" || l === "bot" ? "assistant" : "user";
}

/**
 * Parses Bolna's plain-text transcript ("assistant: ...\nuser: ...") into turns.
 * Text is kept verbatim (only trimmed), because evaluation quotes are checked against it word for word.
 * Lines without a speaker label continue the previous turn; consecutive lines from one speaker are merged.
 */
export function parseTranscript(transcript: string | null | undefined): ParsedTurn[] {
  if (!transcript) return [];
  const turns: ParsedTurn[] = [];
  for (const rawLine of transcript.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const m = rawLine.match(LINE);
    if (m) {
      const role = toRole(m[1]);
      const text = m[2].trim();
      const last = turns[turns.length - 1];
      if (last && last.role === role) {
        if (text) last.content = `${last.content} ${text}`.trim();
      } else {
        turns.push({ role, content: text });
      }
    } else if (turns.length > 0) {
      const last = turns[turns.length - 1];
      last.content = `${last.content} ${rawLine.trim()}`.trim();
    }
  }
  return turns.filter((t) => t.content.length > 0);
}
