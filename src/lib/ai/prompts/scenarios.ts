import type { PersonaData, MeetingContext } from "@/types";

export const SCENARIOS_PROMPT_VERSION = "v1.0";

export function getScenariosSystemPrompt(): string {
  return `You are a high-stakes enterprise deal strategist. Given a counterpart persona and meeting context, you map the most likely friction points, skeptical objections, and the strategic discovery questions the user should ask to establish credibility.

Strict Rules:
1. Objections must include:
   - At least 1 objection in "Risk/Compliance/Security"
   - At least 1 objection in "ROI/Financial"
   - In total 4 to 6 objections covering the 4 categories: "Risk/Compliance/Security", "ROI/Financial", "Implementation", "Status Quo/Vendor".
2. Strategic questions must include 5 to 7 high-impact discovery questions across phases ("rapport", "challenge", "risk_uncovery", "decision_criteria").
3. Tailor objections directly to the persona's background (e.g. if compliance/audit, focus on audit trails, data sovereignty, SLA breaches).
4. Return ONLY valid JSON matching the schema.`;
}

export function getScenariosUserPrompt(persona: PersonaData, meeting: MeetingContext): string {
  return `Target Persona:
Name: ${persona.name}
Title: ${persona.title} at ${persona.company}
Background: ${persona.background}
Risk Posture: ${persona.risk_posture}
Technical Depth: ${persona.technical_depth}
Business Priorities: ${persona.business_priorities.join(", ")}
Hot Buttons: ${persona.hot_buttons.join(", ")}
Conversational Style: ${persona.conversational_style}

Meeting Context:
Product: ${meeting.product_summary}
Goal: ${meeting.goal}
Meeting Type: ${meeting.meeting_type}
Duration: ${meeting.duration_minutes} minutes

Generate the scenario map and strategic questions JSON:
{
  "objections": [
    {
      "category": "Risk/Compliance/Security" | "ROI/Financial" | "Implementation" | "Status Quo/Vendor",
      "objection": string,
      "trigger": string,
      "probability": "high" | "medium" | "low",
      "severity": "critical" | "major" | "moderate",
      "underlying_concern": string,
      "counter_strategy": string
    }
  ],
  "strategic_questions": [
    {
      "phase": "rapport" | "challenge" | "risk_uncovery" | "decision_criteria",
      "question": string,
      "rationale": string,
      "listen_for": string
    }
  ]
}`;
}
