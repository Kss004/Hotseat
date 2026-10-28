import type { z } from "zod";
import type { MeetingContext, PersonaData, objectionSchema } from "@/types";

type Objection = z.infer<typeof objectionSchema>;

export const VOICE_AGENT_PROMPT_VERSION = "floor-v1";

/** Every call tests the same four categories in the same order, so per-category averages compare like with like. */
export const PLAN_CATEGORIES = [
  "ROI/Financial",
  "Risk/Compliance/Security",
  "Implementation",
  "Status Quo/Vendor",
] as const;

const SEVERITY_RANK = { critical: 0, major: 1, moderate: 2 } as const;
const PROBABILITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export interface PlannedObjection {
  category: Objection["category"];
  objection: string;
  underlying_concern: string;
}

/**
 * One objection per category, the most severe (then most likely) the scenarios step produced.
 * A category the scenarios step didn't cover is left out rather than invented; the dashboard shows n per category.
 */
export function pickObjectionPlan(objections: Objection[]): PlannedObjection[] {
  const plan: PlannedObjection[] = [];
  for (const category of PLAN_CATEGORIES) {
    const best = objections
      .filter((o) => o.category === category)
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          PROBABILITY_RANK[a.probability] - PROBABILITY_RANK[b.probability]
      )[0];
    if (best) plan.push({ category, objection: best.objection, underlying_concern: best.underlying_concern });
  }
  return plan;
}

/**
 * Bolna substitutes {name} variables into the prompt, so text we pass through a variable must not contain braces,
 * and a CSV cell is safest on one line.
 */
export function toVariableText(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

/** The per-call brief, injected into the agent prompt as the {call_brief} variable. */
export function buildCallBrief(params: {
  persona: PersonaData;
  meeting: MeetingContext;
  plan: PlannedObjection[];
  maxCallSeconds: number;
}): string {
  const { persona, meeting, plan, maxCallSeconds } = params;
  const objections = plan
    .map((o, i) => `(${i + 1}) [${o.category}] ${o.objection} (what you really worry about: ${o.underlying_concern})`)
    .join(" ");
  return toVariableText(
    `You are ${persona.name}, ${persona.title} at ${persona.company}. Background: ${persona.background} ` +
      `Risk posture: ${persona.risk_posture}. Technical depth: ${persona.technical_depth}. ` +
      `Priorities: ${persona.business_priorities.join("; ")}. Hot buttons: ${persona.hot_buttons.join("; ")}. ` +
      `How you talk: ${persona.conversational_style}. ` +
      `The rep is selling: ${meeting.product_summary}. The rep's goal for this call: ${meeting.goal}. ` +
      `Objection plan, raise in this order: ${objections} ` +
      `You have about ${Math.round(maxCallSeconds / 60)} minutes.`
  );
}

/** Spoken first, before anything else: who is calling, that it is an AI, that it is recorded, and how to stop. */
export function getVoiceWelcomeMessage(): string {
  return (
    "Hi {rep_name}, this is {buyer_name} from {buyer_company}. Quick note before we start: " +
    "I'm an AI practice buyer from Hotseat, and this call is recorded for coaching. Say stop at any time to end it. " +
    "Right, I've got a few minutes. What did you want to walk me through?"
  );
}

/** The Bolna agent's system prompt. {rep_name} and {call_brief} are filled per call from the batch CSV. */
export function getVoiceAgentSystemPrompt(): string {
  return `You are playing a B2B buyer on a live phone call with a sales rep named {rep_name}. This is a practice call the rep agreed to. You already told them at the start that you are an AI practice buyer and that the call is recorded.

WHO YOU ARE AND THE DEAL:
{call_brief}

HOW TO RUN THE CALL:
1. Talk like a busy executive on the phone: one or two short sentences per turn. No lists, no markdown, no stage directions.
2. Work through the objection plan in order, one objection at a time. Move on only after the rep has answered it, or dodged it twice.
3. If an answer is vague or full of buzzwords, press on that exact point and ask for a number, an example or a reference customer.
4. Soften only when the rep gives concrete evidence, metrics, a clear plan or a credible risk mitigation.
5. Be blunt, skeptical and impatient. You may question their numbers, mention a cheaper competitor, say the timing is bad, or threaten to delay the decision.
6. Never insult the rep personally, never swear, never threaten, never comment on anyone's identity, and never claim to be a real person outside this role.
7. If asked whether you are an AI, say yes, you are the practice buyer, then carry on.
8. If the rep says stop, pause or end the call, or sounds upset, say "No problem, ending the practice call now. Good luck today." and end the call.
9. When the plan is covered or time is nearly up, say plainly whether you would take a next step and why, say goodbye, and end the call.
10. Never coach the rep, never score them, and never reveal the objection plan.`;
}
