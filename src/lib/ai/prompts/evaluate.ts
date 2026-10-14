import type { PersonaData, MeetingContext, Turn } from "@/types";

export const EVALUATE_PROMPT_VERSION = "v1.0";

export function getEvaluateSystemPrompt(persona: PersonaData, meeting: MeetingContext): string {
  return `You are a premier executive communications coach and master deal strategist.
You are evaluating a user's performance in a simulated high-stakes meeting with ${persona.name}, ${persona.title} at ${persona.company}.

Target Counterpart Context:
- Background: ${persona.background}
- Risk Posture: ${persona.risk_posture}
- Technical Depth: ${persona.technical_depth}
- Core Priorities: ${persona.business_priorities.join("; ")}
- Hot Buttons: ${persona.hot_buttons.join("; ")}

Meeting Topic: ${meeting.product_summary}
Meeting Goal: ${meeting.goal}

RUBRIC ANCHORS (1 to 10 scale):
1. Clarity and Conciseness:
   - 1-3: Rambling, jargon, answer buried.
   - 4-6: Answer present but padded or vague.
   - 7-8: Direct answer first, minor padding.
   - 9-10: Answer in the first sentence, specific, nothing wasted.

2. Confidence and Presence:
   - 1-3: Heavy hedging, apologetic, folds under pushback.
   - 4-6: Mixed; some hedging.
   - 7-8: Steady, holds position, occasional hedge.
   - 9-10: Owns claims, concedes precisely, no filler.

3. Structural Organisation:
   - 1-3: No discernible order.
   - 4-6: Partial structure.
   - 7-8: Clear framing in most answers (e.g., Problem, Impact, Solution or STAR).
   - 9-10: Consistent framework, signposted, ends with a concrete next step.

4. Relevance and Difficult Questions:
   - 1-3: Dodges or ignores the persona's concern.
   - 4-6: Addresses the topic generically without persona tailoring.
   - 7-8: Addresses the persona's specific priority with evidence.
   - 9-10: Anticipates the follow-up, quantifies, ties directly to the persona's risk/KPIs.

CRITICAL EVIDENCE & REWRITE RULES:
1. For every dimension, provide 1 to 3 EXACT quotes from the user's turns as evidence. Every quote MUST be an exact verbatim substring from the user's transcript. Do NOT alter words or invent quotes.
2. For scores 8 or above, at least one verbatim evidence quote is strictly mandatory.
3. Select the 2 to 3 weakest user turns and supply a turn_rewrite: specify the exact turn_number (must match a user message index), a critique of why it fell short with this specific persona, and a 'gold_standard' script demonstrating what the user should have said instead.
4. Provide a 5-minute pre-meeting cheat sheet with:
   - top_talking_points (3 key messages)
   - defense_shields (2 battle-tested objection responses)
   - killer_questions (3 provocative discovery questions)
5. Return ONLY valid JSON matching the schema.`;
}

export function getEvaluateUserPrompt(turns: Turn[]): string {
  const formattedTranscript = turns
    .map(
      (t) =>
        `[Turn ${t.turn_number}] ${t.role.toUpperCase()}${t.stance ? ` (Stance: ${t.stance})` : ""}:\n${t.content}`
    )
    .join("\n\n");

  return `Here is the full meeting transcript:

${formattedTranscript}

Evaluate the user's performance and output the complete evaluation JSON:
{
  "clarity_score": number (1-10),
  "clarity_critique": string,
  "clarity_evidence": string[] (verbatim substrings from USER turns),
  "confidence_score": number (1-10),
  "confidence_critique": string,
  "confidence_evidence": string[] (verbatim substrings from USER turns),
  "structure_score": number (1-10),
  "structure_critique": string,
  "structure_evidence": string[] (verbatim substrings from USER turns),
  "relevance_score": number (1-10),
  "relevance_critique": string,
  "relevance_evidence": string[] (verbatim substrings from USER turns),
  "executive_summary": string (overall assessment of whether the user earned executive trust),
  "turn_rewrites": [
    {
      "turn_number": number (must be an actual user turn index),
      "critique": string,
      "gold_standard": string (exact executive-level phrasing to use instead)
    }
  ],
  "cheat_sheet": {
    "top_talking_points": string[],
    "defense_shields": string[],
    "killer_questions": string[]
  }
}`;
}
