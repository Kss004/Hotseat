import type { Row } from "@libsql/client";
import type { EvaluationOutput, EvaluationRecord, Turn } from "@/types";
import { filterValidQuotes } from "@/lib/quotes";

const DIMENSIONS = ["clarity", "confidence", "structure", "relevance"] as const;

export interface PostValidationResult {
  evaluation: Omit<EvaluationRecord, "id" | "session_id">;
  droppedQuotes: number;
}

/**
 * Code-side guarantees on top of schema validation (see AGENTS.md "Evaluator Post-Validation"):
 * - evidence quotes must be verbatim substrings of a single user turn; anything else is dropped (never backfilled)
 * - user_said on rewrites and playbook entries comes from the DB turn, never from the LLM
 * - overall_score is the mean of the four dimension scores
 */
export function postValidateEvaluation(data: EvaluationOutput, userTurns: Turn[]): PostValidationResult {
  const userTurnTexts = userTurns.map((t) => t.content);
  const byNumber = new Map(userTurns.map((t) => [t.turn_number, t]));
  const userIndex = new Map(userTurns.map((t, i) => [t.turn_number, i + 1]));
  let droppedQuotes = 0;

  const evidence = {} as Record<(typeof DIMENSIONS)[number], string[]>;
  for (const dim of DIMENSIONS) {
    const raw = data[`${dim}_evidence`];
    const kept = filterValidQuotes(raw, userTurnTexts);
    droppedQuotes += raw.length - kept.length;
    evidence[dim] = kept;
  }

  // Schema refinement already guarantees every turn_number is a user turn; keep one rewrite per turn
  const seenTurns = new Set<number>();
  const turnRewrites = data.turn_rewrites
    .filter((rw) => {
      if (!byNumber.has(rw.turn_number) || seenTurns.has(rw.turn_number)) return false;
      seenTurns.add(rw.turn_number);
      return true;
    })
    .map((rw) => ({
      turn_number: rw.turn_number,
      user_turn_index: userIndex.get(rw.turn_number),
      user_said: byNumber.get(rw.turn_number)!.content,
      critique: rw.critique,
      gold_standard: rw.gold_standard,
    }));

  const objectionPlaybook = data.objection_playbook.map((entry) => {
    const turn = entry.user_turn_number !== null ? byNumber.get(entry.user_turn_number) : undefined;
    return {
      ...entry,
      user_turn_number: turn ? turn.turn_number : null,
      user_turn_index: turn ? userIndex.get(turn.turn_number) ?? null : null,
      user_said: turn ? turn.content : null,
    };
  });

  const overallScore = Number(
    ((data.clarity_score + data.confidence_score + data.structure_score + data.relevance_score) / 4).toFixed(1)
  );

  return {
    droppedQuotes,
    evaluation: {
      clarity_score: data.clarity_score,
      clarity_critique: data.clarity_critique,
      clarity_evidence: evidence.clarity,
      confidence_score: data.confidence_score,
      confidence_critique: data.confidence_critique,
      confidence_evidence: evidence.confidence,
      structure_score: data.structure_score,
      structure_critique: data.structure_critique,
      structure_evidence: evidence.structure,
      relevance_score: data.relevance_score,
      relevance_critique: data.relevance_critique,
      relevance_evidence: evidence.relevance,
      overall_score: overallScore,
      executive_summary: data.executive_summary,
      turn_rewrites: turnRewrites,
      objection_playbook: objectionPlaybook,
      cheat_sheet: data.cheat_sheet,
    },
  };
}

export const EVALUATION_COLUMNS = `id, clarity_score, clarity_critique, clarity_evidence,
  confidence_score, confidence_critique, confidence_evidence,
  structure_score, structure_critique, structure_evidence,
  relevance_score, relevance_critique, relevance_evidence,
  overall_score, executive_summary, turn_rewrites, objection_playbook, cheat_sheet`;

export function rowToEvaluation(e: Row, sessionId: string): EvaluationRecord {
  return {
    id: e.id as string,
    session_id: sessionId,
    clarity_score: Number(e.clarity_score),
    clarity_critique: e.clarity_critique as string,
    clarity_evidence: JSON.parse(e.clarity_evidence as string),
    confidence_score: Number(e.confidence_score),
    confidence_critique: e.confidence_critique as string,
    confidence_evidence: JSON.parse(e.confidence_evidence as string),
    structure_score: Number(e.structure_score),
    structure_critique: e.structure_critique as string,
    structure_evidence: JSON.parse(e.structure_evidence as string),
    relevance_score: Number(e.relevance_score),
    relevance_critique: e.relevance_critique as string,
    relevance_evidence: JSON.parse(e.relevance_evidence as string),
    overall_score: Number(e.overall_score),
    executive_summary: e.executive_summary as string,
    turn_rewrites: JSON.parse(e.turn_rewrites as string),
    objection_playbook: JSON.parse((e.objection_playbook as string | null) || "[]"),
    cheat_sheet: JSON.parse(e.cheat_sheet as string),
  };
}
