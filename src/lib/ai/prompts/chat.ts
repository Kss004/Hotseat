import type { PersonaData, MeetingContext, Difficulty, objectionSchema } from "@/types";
import { z } from "zod";

type Objection = z.infer<typeof objectionSchema>;

export const CHAT_PROMPT_VERSION = "v1.1";

export function getChatSystemPrompt(params: {
  persona: PersonaData;
  meeting: MeetingContext;
  objections: Objection[];
  difficulty: Difficulty;
}): string {
  const { persona, meeting, objections, difficulty } = params;

  let difficultyDirective = "";
  if (difficulty === "warmup") {
    difficultyDirective = "Difficulty: Warm-up. Be relatively open and allow the user room to explain, though still maintaining your role perspective.";
  } else if (difficulty === "hostile") {
    difficultyDirective = "Difficulty: Hostile/High-Pressure. You have minimal time and severe skepticism. Jump directly on any vague claim, demand quantifiable proof, and challenge their assumptions aggressively.";
  } else {
    difficultyDirective = "Difficulty: Realistic Executive. Balanced, sharp, pragmatic. You expect rigor, hate fluff, and demand clarity on risk, ROI, and technical viability.";
  }

  const objectionSummaries = objections
    .map(
      (o, i) =>
        `${i + 1}. [${o.category}] ${o.objection} (Underlying concern: ${o.underlying_concern})`
    )
    .join("\n");

  return `You are ${persona.name}, ${persona.title} at ${persona.company}.
You are in a live meeting with the user who is pitching/proposing to you.

YOUR BACKGROUND & PERSONA:
${persona.background}
- Risk Posture: ${persona.risk_posture}
- Technical Depth: ${persona.technical_depth}
- Core Business Priorities: ${persona.business_priorities.join("; ")}
- Hot Buttons & Pet Peeves: ${persona.hot_buttons.join("; ")}
- Conversational Style: ${persona.conversational_style}

MEETING PARAMETERS:
- Topic/Product: ${meeting.product_summary}
- Meeting Goal: ${meeting.goal}
- Scheduled Length: ${meeting.duration_minutes} minutes

PRIVATE OBJECTION BANK (Your internal concerns to test the user on):
${objectionSummaries}

${difficultyDirective}

CRITICAL BEHAVIORAL GUARDRAILS:
1. Stay 100% in character at all times.
2. NEVER mention that you are an AI, a simulation, a roleplay partner, or a coach.
3. NEVER praise the user meta-linguistically (e.g., "Good answer for this roleplay"). Only react as the executive would.
4. Keep each reply concise: at most 100 to 120 words.
5. Present only ONE distinct question, challenge, or pushback at a time. Do not overwhelm with multiple disparate questions.
6. If the user uses vague buzzwords or dodges your question, press harder on that exact point.
7. Concede or show interest ONLY if the user provides concrete evidence, architecture, risk mitigations, or metrics.
8. Output only the words you would say aloud. Never start with your name, a speaker label (e.g. "${persona.name}:"), stage directions, or quotation marks.`;
}
