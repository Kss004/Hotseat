import { z } from "zod";

// ==========================================
// Session & Meeting Context Schemas
// ==========================================

export const meetingContextSchema = z.object({
  product_summary: z.string().min(1, "Product summary is required"),
  goal: z.string().min(1, "Goal is required"),
  meeting_type: z.string().default("Enterprise Sales Pitch"),
  duration_minutes: z.coerce.number().int().positive().default(30),
  // Live web research on the counterpart's company at the briefing step; missing (older sessions) counts as on
  web_research: z.boolean().optional(),
});

export type MeetingContext = z.infer<typeof meetingContextSchema>;

export type Difficulty = "warmup" | "realistic" | "hostile";
export type SessionStatus =
  | "draft"
  | "persona_ready"
  | "scenarios_ready"
  | "roleplay_active"
  | "ended"
  | "evaluated";

export interface Session {
  id: string;
  created_at: string;
  title: string;
  target_url?: string | null;
  raw_input: string;
  meeting_context: MeetingContext;
  difficulty: Difficulty;
  max_turns: number;
  status: SessionStatus;
}

// ==========================================
// Persona Schemas
// ==========================================

export type RiskPosture = "risk_averse" | "moderate" | "aggressive";
export type TechnicalDepth = "high" | "moderate" | "low";

export const personaSchema = z.object({
  name: z.string().min(1, "Name is required"),
  title: z.string().min(1, "Title is required"),
  company: z.string().min(1, "Company is required"),
  background: z.string().min(1, "Background is required"),
  risk_posture: z.enum(["risk_averse", "moderate", "aggressive"]),
  technical_depth: z.enum(["high", "moderate", "low"]),
  business_priorities: z.array(z.string()).min(1, "At least one priority required"),
  hot_buttons: z.array(z.string()).min(1, "At least one hot button required"),
  conversational_style: z.string().min(1, "Conversational style is required"),
  uncertain_fields: z.array(z.string()).default([]),
});

export type PersonaData = z.infer<typeof personaSchema>;

export interface PersonaRecord extends PersonaData {
  id: string;
  session_id: string;
  edited_by_user: boolean;
  updated_at: string;
}

// ==========================================
// Scenarios & Strategic Questions Schemas
// ==========================================

export const objectionCategorySchema = z.enum([
  "Risk/Compliance/Security",
  "ROI/Financial",
  "Implementation",
  "Status Quo/Vendor",
]);

export const objectionSchema = z.object({
  category: objectionCategorySchema,
  objection: z.string().min(1),
  trigger: z.string().min(1),
  probability: z.enum(["high", "medium", "low"]),
  severity: z.enum(["critical", "major", "moderate"]),
  underlying_concern: z.string().min(1),
  counter_strategy: z.string().min(1),
});

export const strategicQuestionSchema = z.object({
  phase: z.enum(["rapport", "challenge", "risk_uncovery", "decision_criteria"]),
  question: z.string().min(1),
  rationale: z.string().min(1),
  listen_for: z.string().min(1),
});

export const scenariosOutputSchema = z.object({
  objections: z.array(objectionSchema).min(4).max(6),
  strategic_questions: z.array(strategicQuestionSchema).min(5).max(7),
});

export type ScenariosOutput = z.infer<typeof scenariosOutputSchema>;

export interface ScenariosRecord {
  id: string;
  session_id: string;
  objections: z.infer<typeof objectionSchema>[];
  strategic_questions: z.infer<typeof strategicQuestionSchema>[];
}

// ==========================================
// Live Company Research (Tavily)
// ==========================================

/** Mirrors ResearchResult in src/lib/research/tavily.ts, which is server-only (it reads fixtures from disk). */
export interface ResearchFindingRecord {
  title: string;
  url: string;
  source: string;
  snippet: string;
  published_date?: string;
}

export type ResearchStatus = "ok" | "skipped" | "unavailable" | "not_configured";

export interface ResearchRecord {
  status: ResearchStatus;
  reason?: string;
  queries: string[];
  findings: ResearchFindingRecord[];
  cached?: boolean;
}

// ==========================================
// Turns & Sparring Chat Schemas
// ==========================================

export type Stance =
  | "skeptical"
  | "guarded"
  | "neutral"
  | "intrigued"
  | "convinced"
  | "impatient";

export interface Turn {
  id: string;
  session_id: string;
  turn_number: number;
  role: "user" | "assistant";
  content: string;
  stance?: Stance | null;
  created_at: string;
}

export const stanceOutputSchema = z.object({
  stance: z.enum([
    "skeptical",
    "guarded",
    "neutral",
    "intrigued",
    "convinced",
    "impatient",
  ]),
  reasoning: z.string().optional(),
});

// ==========================================
// Evaluation & Post-Mortem Schemas
// ==========================================

export const objectionPlaybookEntrySchema = z.object({
  objection: z.string().min(1),
  category: objectionCategorySchema,
  user_turn_number: z.number().int().positive().nullable(),
  what_went_wrong: z.string().min(1),
  framework_name: z.string().min(1),
  framework_steps: z.array(z.string().min(1)).min(3).max(5),
  example_response: z.string().min(1),
});

export const evaluationOutputSchema = z.object({
  clarity_score: z.number().int().min(1).max(10),
  clarity_critique: z.string().min(1),
  clarity_evidence: z.array(z.string()).min(1),

  confidence_score: z.number().int().min(1).max(10),
  confidence_critique: z.string().min(1),
  confidence_evidence: z.array(z.string()).min(1),

  structure_score: z.number().int().min(1).max(10),
  structure_critique: z.string().min(1),
  structure_evidence: z.array(z.string()).min(1),

  relevance_score: z.number().int().min(1).max(10),
  relevance_critique: z.string().min(1),
  relevance_evidence: z.array(z.string()).min(1),

  executive_summary: z.string().min(1),
  turn_rewrites: z.array(
    z.object({
      turn_number: z.number().int().positive(),
      critique: z.string().min(1),
      gold_standard: z.string().min(1),
    })
  ).min(2),

  // Framework coaching for the hardest pushback the persona raised (e.g. budget/ROI, security)
  objection_playbook: z.array(objectionPlaybookEntrySchema).min(1).max(3),

  cheat_sheet: z.object({
    top_talking_points: z.array(z.string()).min(1),
    defense_shields: z.array(z.string()).min(1),
    killer_questions: z.array(z.string()).min(1),
  }),
});

export type EvaluationOutput = z.infer<typeof evaluationOutputSchema>;
export type ObjectionPlaybookEntry = z.infer<typeof objectionPlaybookEntrySchema>;

/**
 * Per-request schema: rewrite and playbook turn numbers must point at real user turns.
 * Failing this triggers the router's single repair retry with the exact error, instead of patching output in code.
 */
export function buildEvaluationSchema(userTurnNumbers: number[]) {
  const valid = new Set(userTurnNumbers);
  const list = userTurnNumbers.join(", ");
  return evaluationOutputSchema.superRefine((data, ctx) => {
    const rewriteTurns = new Set<number>();
    data.turn_rewrites.forEach((rw, i) => {
      if (!valid.has(rw.turn_number)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["turn_rewrites", i, "turn_number"],
          message: `turn_number ${rw.turn_number} is not a USER turn. Valid user turn numbers: ${list}`,
        });
      }
      rewriteTurns.add(rw.turn_number);
    });
    if (rewriteTurns.size < Math.min(2, valid.size)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["turn_rewrites"],
        message: `turn_rewrites must cover at least 2 distinct USER turns from: ${list}`,
      });
    }
    data.objection_playbook.forEach((entry, i) => {
      if (entry.user_turn_number !== null && !valid.has(entry.user_turn_number)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["objection_playbook", i, "user_turn_number"],
          message: `user_turn_number ${entry.user_turn_number} is not a USER turn. Use null or one of: ${list}`,
        });
      }
    });
  });
}

export interface EvaluationRecord {
  id: string;
  session_id: string;
  clarity_score: number;
  clarity_critique: string;
  clarity_evidence: string[];
  confidence_score: number;
  confidence_critique: string;
  confidence_evidence: string[];
  structure_score: number;
  structure_critique: string;
  structure_evidence: string[];
  relevance_score: number;
  relevance_critique: string;
  relevance_evidence: string[];
  overall_score: number;
  executive_summary: string;
  turn_rewrites: {
    turn_number: number;
    /** 1-based position among the user's own messages (turn_number also counts persona replies) */
    user_turn_index?: number;
    user_said: string;
    critique: string;
    gold_standard: string;
  }[];
  objection_playbook: (ObjectionPlaybookEntry & { user_said: string | null; user_turn_index?: number | null })[];
  cheat_sheet: {
    top_talking_points: string[];
    defense_shields: string[];
    killer_questions: string[];
  };
}

// ==========================================
// LLM Call Logging Schema
// ==========================================

export type LLMPurpose = "persona" | "scenarios" | "chat" | "stance" | "evaluate";
export type LLMCallStatus = "ok" | "failover" | "error";

export interface LLMCallRecord {
  id: string;
  session_id?: string | null;
  purpose: LLMPurpose;
  provider: string;
  model: string;
  prompt_version: string;
  latency_ms?: number | null;
  status: LLMCallStatus;
  error_code?: string | null;
  created_at: string;
}
