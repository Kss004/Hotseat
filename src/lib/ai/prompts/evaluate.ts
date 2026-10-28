import type { PersonaData, MeetingContext, Turn } from "@/types";

export const EVALUATE_PROMPT_VERSION = "v1.2";

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
4. objection_playbook (1 to 6 entries): one entry for EVERY distinct objection or pushback ${persona.name} raised, in the order raised (merge repeats of the same concern; at most 6). For each:
   - objection: the pushback in one sentence, as the persona framed it
   - category: one of "Risk/Compliance/Security", "ROI/Financial", "Implementation", "Status Quo/Vendor"
   - user_turn_number: the USER turn that answered it, or null if the user never answered it
   - what_went_wrong: the specific gap in the user's answer (be concrete; if the answer was strong, say what would make it airtight)
   - framework_name: a short named framework suited to this objection type (e.g. "Acknowledge, Quantify, Prove, Commit" for budget; "Control, Evidence, Contract" for security)
   - framework_steps: 3 to 5 steps, each one line, describing how to apply the framework to THIS persona
   - example_response: a 2 to 4 sentence answer applying the framework, using only facts from the meeting context or the user's own claims. Do not invent product capabilities, certifications or numbers.
   - handling_score (1 to 10): how well the user handled THIS objection. 1-3: dodged, ignored or never answered. 4-6: answered generically, no evidence or tailoring. 7-8: addressed the specific concern with evidence. 9-10: resolved it, quantified, and moved the deal forward.
   - evidence: 0 to 2 EXACT verbatim quotes from the user's answer to this objection (same rule as dimension evidence).
5. Gold-standard rewrites follow the same rule: no invented product facts; where a number is needed, write a placeholder like [your payback period].
6. Provide a 5-minute pre-meeting cheat sheet with:
   - top_talking_points (3 key messages)
   - defense_shields (2 battle-tested objection responses)
   - killer_questions (3 provocative discovery questions)
7. In all prose (critiques, executive_summary, what_went_wrong), refer to the user's turns as "message #N" using the message number shown in the transcript, never as "Turn N". Turn numbers are only for the turn_number and user_turn_number fields.
8. Return ONLY valid JSON matching the schema.`;
}

export function getEvaluateUserPrompt(turns: Turn[]): string {
  const userTurnNumbers = turns.filter((t) => t.role === "user").map((t) => t.turn_number);
  // The UI calls user turns "message #N" (counting only user turns), so the evaluator's prose must use the same numbering
  let userMessageCount = 0;
  const formattedTranscript = turns
    .map((t) => {
      const messageLabel = t.role === "user" ? ` (message #${++userMessageCount})` : "";
      return `[Turn ${t.turn_number}] ${t.role.toUpperCase()}${messageLabel}${t.stance ? ` (Stance: ${t.stance})` : ""}:\n${t.content}`;
    })
    .join("\n\n");

  return `Here is the full meeting transcript:

${formattedTranscript}

Valid USER turn numbers (the only values allowed for turn_number and user_turn_number): ${userTurnNumbers.join(", ")}

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
  "objection_playbook": [
    {
      "objection": string,
      "category": "Risk/Compliance/Security" | "ROI/Financial" | "Implementation" | "Status Quo/Vendor",
      "user_turn_number": number | null,
      "what_went_wrong": string,
      "framework_name": string,
      "framework_steps": string[] (3-5),
      "example_response": string,
      "handling_score": number (1-10),
      "evidence": string[] (0-2 verbatim substrings from USER turns)
    }
  ],
  "cheat_sheet": {
    "top_talking_points": string[],
    "defense_shields": string[],
    "killer_questions": string[]
  }
}`;
}
