"use client";

import React, { useState } from "react";
import type { EvaluationRecord, PersonaRecord } from "@/types";

interface AnalyticsReportProps {
  evaluation: EvaluationRecord;
  persona: PersonaRecord;
  onNewSession: () => void;
}

export function AnalyticsReport({ evaluation, persona, onNewSession }: AnalyticsReportProps) {
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);

  const getScoreColor = (score: number) => {
    if (score >= 8) return "var(--accent-emerald)";
    if (score >= 6) return "var(--accent-gold)";
    return "var(--accent-rose)";
  };

  const handleCopyMarkdown = async () => {
    const md = `# Executive Meeting Preparation Report: ${persona.name} (${persona.company})
**Overall Score:** ${evaluation.overall_score} / 10

## Executive Summary
${evaluation.executive_summary}

## Dimension Scores
- **Clarity & Conciseness:** ${evaluation.clarity_score}/10
  Critique: ${evaluation.clarity_critique}
- **Confidence & Executive Presence:** ${evaluation.confidence_score}/10
  Critique: ${evaluation.confidence_critique}
- **Structural Organisation:** ${evaluation.structure_score}/10
  Critique: ${evaluation.structure_critique}
- **Relevance & Difficult Questions:** ${evaluation.relevance_score}/10
  Critique: ${evaluation.relevance_critique}

## Turn-by-Turn Gold Standard Rewrites
${evaluation.turn_rewrites
  .map(
    (rw) => `### Turn ${rw.turn_number}
**What you said:** "${rw.user_said}"
**Critique:** ${rw.critique}
**Say this instead:** "${rw.gold_standard}"`
  )
  .join("\n\n")}

## 5-Minute Pre-Meeting Cheat Sheet
### Top Talking Points
${evaluation.cheat_sheet.top_talking_points.map((p) => `- ${p}`).join("\n")}

### Defensive Shields
${evaluation.cheat_sheet.defense_shields.map((s) => `- ${s}`).join("\n")}

### Killer Questions to Ask
${evaluation.cheat_sheet.killer_questions.map((q) => `- ${q}`).join("\n")}
`;

    try {
      await navigator.clipboard.writeText(md);
      setCopiedMarkdown(true);
      setTimeout(() => setCopiedMarkdown(false), 2500);
    } catch {
      // fallback
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const dimensions = [
    {
      title: "Clarity & Conciseness",
      score: evaluation.clarity_score,
      critique: evaluation.clarity_critique,
      evidence: evaluation.clarity_evidence,
    },
    {
      title: "Confidence & Executive Presence",
      score: evaluation.confidence_score,
      critique: evaluation.confidence_critique,
      evidence: evaluation.confidence_evidence,
    },
    {
      title: "Structural Organisation",
      score: evaluation.structure_score,
      critique: evaluation.structure_critique,
      evidence: evaluation.structure_evidence,
    },
    {
      title: "Relevance & Handling Difficult Questions",
      score: evaluation.relevance_score,
      critique: evaluation.relevance_critique,
      evidence: evaluation.relevance_evidence,
    },
  ];

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", paddingBottom: "4rem" }}>
      {/* Top Header Actions */}
      <div
        className="glass-card no-print"
        style={{
          padding: "1.25rem 2rem",
          marginBottom: "2rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <span className="badge badge-gold">Post-Simulation Analytics</span>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 800, marginTop: "0.25rem" }}>
            Performance & Coaching Report
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Target: {persona.name} ({persona.title}, {persona.company})
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button className="btn btn-secondary" onClick={handleCopyMarkdown} id="btn-copy-markdown">
            {copiedMarkdown ? "✓ Copied Markdown" : "📋 Copy as Markdown"}
          </button>
          <button className="btn btn-secondary" onClick={handlePrint} id="btn-print-cheatsheet">
            🖨️ Print Cheat Sheet
          </button>
          <button className="btn btn-primary" onClick={onNewSession} id="btn-start-new-session">
            + New Preparation
          </button>
        </div>
      </div>

      {/* Score Summary & Executive Assessment */}
      <div
        className="glass-card"
        style={{
          padding: "2rem",
          marginBottom: "2rem",
          display: "grid",
          gridTemplateColumns: "220px 1fr",
          gap: "2.5rem",
          alignItems: "center",
        }}
      >
        {/* Overall Score Circle */}
        <div style={{ textAlign: "center", borderRight: "1px solid var(--border-subtle)", paddingRight: "1.5rem" }}>
          <div
            style={{
              width: "130px",
              height: "130px",
              borderRadius: "50%",
              margin: "0 auto 1rem",
              border: `4px solid ${getScoreColor(evaluation.overall_score)}`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 0 24px ${getScoreColor(evaluation.overall_score)}33`,
            }}
          >
            <div style={{ fontSize: "2.6rem", fontWeight: 800, lineHeight: 1 }}>
              {evaluation.overall_score}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
              out of 10
            </div>
          </div>
          <div style={{ fontSize: "0.85rem", fontWeight: 700, color: getScoreColor(evaluation.overall_score) }}>
            {evaluation.overall_score >= 8.5
              ? "Executive Partner Ready"
              : evaluation.overall_score >= 7.0
              ? "Solid Pitch with Vulnerabilities"
              : "High Risk of Disqualification"}
          </div>
        </div>

        {/* Executive Summary */}
        <div>
          <h3 style={{ fontSize: "1.2rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text-primary)" }}>
            Executive Assessment
          </h3>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.95rem", lineHeight: 1.6, marginBottom: "1rem" }}>
            {evaluation.executive_summary}
          </p>
        </div>
      </div>

      {/* 4 Core PRD Dimensions */}
      <div style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "1rem", color: "var(--text-gold)" }}>
          Dimension Diagnostic Breakdown
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
          {dimensions.map((dim, i) => (
            <div
              key={i}
              className="glass-card"
              style={{
                padding: "1.5rem",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <h4 style={{ fontSize: "1rem", fontWeight: 700 }}>{dim.title}</h4>
                  <span
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 800,
                      color: getScoreColor(dim.score),
                      padding: "0.2rem 0.6rem",
                      borderRadius: "var(--radius-sm)",
                      background: "rgba(0,0,0,0.3)",
                      border: `1px solid ${getScoreColor(dim.score)}44`,
                    }}
                  >
                    {dim.score} / 10
                  </span>
                </div>

                {/* Progress bar */}
                <div
                  style={{
                    height: "6px",
                    background: "rgba(255,255,255,0.08)",
                    borderRadius: "var(--radius-full)",
                    marginBottom: "1rem",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${dim.score * 10}%`,
                      height: "100%",
                      background: getScoreColor(dim.score),
                    }}
                  />
                </div>

                <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", lineHeight: 1.55, marginBottom: "1rem" }}>
                  {dim.critique}
                </p>
              </div>

              {/* Evidence Quotes */}
              {dim.evidence && dim.evidence.length > 0 && (
                <div
                  style={{
                    borderTop: "1px solid var(--border-subtle)",
                    paddingTop: "0.75rem",
                    fontSize: "0.8rem",
                  }}
                >
                  <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>CITED EVIDENCE:</span>
                  {dim.evidence.map((quote, qIdx) => (
                    <div
                      key={qIdx}
                      style={{
                        fontStyle: "italic",
                        color: "var(--accent-blue)",
                        marginTop: "0.25rem",
                      }}
                    >
                      &quot;{quote}&quot;
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Turn-by-Turn Post-Mortem & Rewrites */}
      <div style={{ marginBottom: "2.5rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "1rem", color: "var(--accent-rose)" }}>
          Turn-by-Turn Post-Mortem: &quot;Say This Instead&quot;
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1rem" }}>
          Targeted interventions on the weakest moments of your pitch, rewritten for maximum executive impact.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {evaluation.turn_rewrites.map((rw, i) => (
            <div
              key={i}
              className="glass-card"
              style={{
                padding: "1.5rem",
                borderLeft: "4px solid var(--accent-rose)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <span className="badge badge-rose">Weak Moment: Turn {rw.turn_number}</span>
                <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>{rw.critique}</span>
              </div>

              {/* What you said */}
              <div
                style={{
                  padding: "0.75rem 1rem",
                  background: "rgba(244, 63, 94, 0.08)",
                  borderRadius: "var(--radius-sm)",
                  marginBottom: "0.75rem",
                  fontSize: "0.9rem",
                  color: "#fecdd3",
                }}
              >
                <div style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.2rem" }}>
                  What You Said:
                </div>
                &quot;{rw.user_said}&quot;
              </div>

              {/* Gold standard rewrite */}
              <div
                style={{
                  padding: "0.85rem 1rem",
                  background: "rgba(16, 185, 129, 0.1)",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.95rem",
                  color: "#d1fae5",
                }}
              >
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--accent-emerald)", textTransform: "uppercase", marginBottom: "0.2rem" }}>
                  💡 Say This Instead (Gold Standard Script):
                </div>
                &quot;{rw.gold_standard}&quot;
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5-Minute Pre-Meeting Cheat Sheet (Print Target) */}
      <div
        className="glass-card"
        id="cheat-sheet-section"
        style={{
          padding: "2rem",
          border: "2px solid var(--accent-gold)",
          background: "linear-gradient(180deg, rgba(229, 169, 60, 0.05) 0%, rgba(18, 24, 38, 0.8) 100%)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div>
            <span className="badge badge-gold">Executive Summary</span>
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginTop: "0.25rem", color: "var(--accent-gold)" }}>
              5-Minute Pre-Meeting Cheat Sheet
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>
              Keep this open or print it out 5 minutes before your actual call with {persona.name}.
            </p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.5rem" }}>
          {/* Top Talking Points */}
          <div
            style={{
              padding: "1.25rem",
              background: "var(--bg-elevated)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--accent-gold)", marginBottom: "0.75rem" }}>
              🎯 Top Talking Points
            </h4>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {evaluation.cheat_sheet.top_talking_points.map((pt, i) => (
                <li key={i} style={{ fontSize: "0.85rem", color: "var(--text-primary)", lineHeight: 1.45 }}>
                  • {pt}
                </li>
              ))}
            </ul>
          </div>

          {/* Defense Shields */}
          <div
            style={{
              padding: "1.25rem",
              background: "var(--bg-elevated)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--accent-rose)", marginBottom: "0.75rem" }}>
              🛡️ Defensive Shields
            </h4>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {evaluation.cheat_sheet.defense_shields.map((sh, i) => (
                <li key={i} style={{ fontSize: "0.85rem", color: "var(--text-primary)", lineHeight: 1.45 }}>
                  • {sh}
                </li>
              ))}
            </ul>
          </div>

          {/* Killer Questions */}
          <div
            style={{
              padding: "1.25rem",
              background: "var(--bg-elevated)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <h4 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--accent-cyan)", marginBottom: "0.75rem" }}>
              ⚡ Killer Questions to Ask
            </h4>
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {evaluation.cheat_sheet.killer_questions.map((kq, i) => (
                <li key={i} style={{ fontSize: "0.85rem", color: "var(--text-primary)", lineHeight: 1.45 }}>
                  • {kq}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
