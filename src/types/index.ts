import { z } from "zod";

// ==========================================
// Session & Meeting Context Schemas
// ==========================================

export const meetingContextSchema = z.object({
  product_summary: z.string().min(1, "Product summary is required"),
  goal: z.string().min(1, "Goal is required"),
  meeting_type: z.string().default("Enterprise Sales Pitch"),
  duration_minutes: z.coerce.number().int().positive().default(30),
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
  edited_by_user: number;
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

  cheat_sheet: z.object({
    top_talking_points: z.array(z.string()).min(1),
    defense_shields: z.array(z.string()).min(1),
    killer_questions: z.array(z.string()).min(1),
  }),
});

export type EvaluationOutput = z.infer<typeof evaluationOutputSchema>;

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
    user_said: string;
    critique: string;
    gold_standard: string;
  }[];
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
