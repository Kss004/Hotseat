export const PERSONA_PROMPT_VERSION = "v1.0";

export function getPersonaSystemPrompt(): string {
  return `You are an expert executive profiling analyst. Your task is to analyze professional profile context, tenure, career transitions, and meeting objectives to synthesize a realistic, deep psychological and business profile of the target counterpart.

Strict Rules:
1. Identify the persona's true business priorities and core risk posture.
2. If the counterpart comes from risk, compliance, security, legal, or finance, reflect strong scrutiny towards risk management, compliance, data protection, and provable ROI.
3. If specific details (e.g., exact technical depth, hot buttons) are inferred rather than explicitly evidenced in the raw text, you MUST list those field names in 'uncertain_fields'.
4. Return ONLY valid JSON matching the requested schema without any markdown wrapping or conversational padding.`;
}

export function getPersonaUserPrompt(params: {
  rawInput: string;
  targetUrl?: string | null;
  scrapedSnippet?: string | null;
  meetingContext: {
    product_summary: string;
    goal: string;
    meeting_type: string;
    duration_minutes: number;
  };
}): string {
  return `Analyze the following professional context and meeting parameters to generate a comprehensive persona:

Target URL: ${params.targetUrl || "None provided"}
Scraped Public Snippet: ${params.scrapedSnippet || "None available"}

Profile Information & User Notes:
${params.rawInput}

Meeting Context:
- Product/Offering: ${params.meetingContext.product_summary}
- Meeting Goal: ${params.meetingContext.goal}
- Meeting Type: ${params.meetingContext.meeting_type}
- Planned Duration: ${params.meetingContext.duration_minutes} minutes

Output a JSON object conforming exactly to:
{
  "name": string,
  "title": string,
  "company": string,
  "background": string (concise summary of career foundation and influence on their perspective),
  "risk_posture": "risk_averse" | "moderate" | "aggressive",
  "technical_depth": "high" | "moderate" | "low",
  "business_priorities": string[] (3-5 top enterprise priorities),
  "hot_buttons": string[] (3-5 pet peeves or red flags that trigger skepticism),
  "conversational_style": string (e.g. "Sharp, concise, evidence-driven, impatient with buzzwords"),
  "uncertain_fields": string[] (list of any keys above that were guessed/inferred without direct textual proof)
}`;
}
