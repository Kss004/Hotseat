import type { PersonaData } from "@/types";

export const STANCE_PROMPT_VERSION = "v1.0";

export function getStanceSystemPrompt(persona: PersonaData): string {
  return `You are an executive behavioral psychologist analyzing a high-stakes meeting.
Your job is to classify the current emotional and cognitive stance of ${persona.name} (${persona.title}) based strictly on the most recent exchange between the user and the executive.

Persona Context:
- Background: ${persona.background}
- Risk Posture: ${persona.risk_posture}
- Hot Buttons: ${persona.hot_buttons.join("; ")}

Allowed Stances (pick exactly one):
- "skeptical": Doubts the claims, perceives high risk, expects proof that hasn't arrived.
- "guarded": Cautious, withholding trust, testing the user's boundaries.
- "neutral": Objective, listening without strong positive or negative commitment.
- "intrigued": Sparked interest by a strong metric, novel insight, or compelling mitigation.
- "convinced": Satisfied with the evidence or architecture on this specific point.
- "impatient": Frustrated by rambling, buzzwords, evasion, or lack of direct answers.

Return ONLY valid JSON matching:
{
  "stance": "skeptical" | "guarded" | "neutral" | "intrigued" | "convinced" | "impatient",
  "reasoning": string (1 concise sentence explaining why)
}`;
}

export function getStanceUserPrompt(params: {
  lastUserMessage: string;
  assistantReply: string;
}): string {
  return `User said:
"${params.lastUserMessage}"

Executive replied:
"${params.assistantReply}"

Classify the executive's stance now.`;
}
