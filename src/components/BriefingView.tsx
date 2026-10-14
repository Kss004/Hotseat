"use client";

import React, { useState } from "react";
import type { ScenariosRecord, Difficulty } from "@/types";

interface BriefingViewProps {
  scenarios: ScenariosRecord;
  difficulty: Difficulty;
  onStartSparring: () => void;
}

export function BriefingView({ scenarios, difficulty, onStartSparring }: BriefingViewProps) {
  const [copiedQuestionIdx, setCopiedQuestionIdx] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const copyToClipboard = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedQuestionIdx(idx);
      setTimeout(() => setCopiedQuestionIdx(null), 2000);
    } catch {
      // Fallback
    }
  };

  const getCategoryBadgeClass = (category: string) => {
    switch (category) {
      case "Risk/Compliance/Security":
        return "badge-rose";
      case "ROI/Financial":
        return "badge-gold";
      case "Implementation":
        return "badge-blue";
      default:
        return "badge-emerald";
    }
  };

  const filteredObjections =
    selectedCategory === "all"
      ? scenarios.objections
      : scenarios.objections.filter((o) => o.category === selectedCategory);

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
      {/* Top Banner */}
      <div
        className="glass-card"
        style={{
          padding: "1.5rem 2rem",
          marginBottom: "2rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
            <span className="badge badge-gold">Pre-Meeting Tactical Briefing</span>
            <span className="badge badge-blue">Difficulty: {difficulty.toUpperCase()}</span>
          </div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 800 }}>
            Predictive Scenario Map & Strategic Playbook
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Review the expected objections and equip yourself with targeted discovery questions before entering the sparring ring.
          </p>
        </div>

        <button
          className="btn btn-primary"
          id="btn-launch-sparring"
          onClick={onStartSparring}
          style={{ padding: "0.85rem 1.75rem", fontSize: "0.95rem" }}
        >
          Enter Sparring Arena →
        </button>
      </div>

      {/* Main Grid: Objections on left, Questions on right */}
      <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "2rem" }}>
        {/* Left Column: Predictive Objection Map */}
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-primary)" }}>
              🎯 Predictive Objection Map ({scenarios.objections.length})
            </h3>

            {/* Category Filter */}
            <select
              className="form-control"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              style={{ padding: "0.3rem 0.6rem", fontSize: "0.75rem" }}
            >
              <option value="all">All Categories</option>
              <option value="Risk/Compliance/Security">Risk & Security</option>
              <option value="ROI/Financial">ROI & Financial</option>
              <option value="Implementation">Implementation</option>
              <option value="Status Quo/Vendor">Status Quo</option>
            </select>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {filteredObjections.map((obj, i) => (
              <div
                key={i}
                className="glass-card"
                style={{
                  padding: "1.25rem",
                  borderLeft: `4px solid ${
                    obj.category === "Risk/Compliance/Security"
                      ? "var(--accent-rose)"
                      : obj.category === "ROI/Financial"
                      ? "var(--accent-gold)"
                      : "var(--accent-blue)"
                  }`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                  <span className={`badge ${getCategoryBadgeClass(obj.category)}`}>
                    {obj.category}
                  </span>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                      Prob: <strong style={{ color: "var(--text-primary)" }}>{obj.probability}</strong>
                    </span>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
                      Sev: <strong style={{ color: "var(--accent-rose)" }}>{obj.severity}</strong>
                    </span>
                  </div>
                </div>

                <h4 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--text-primary)", lineHeight: 1.4 }}>
                  &quot;{obj.objection}&quot;
                </h4>

                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.6rem" }}>
                  <strong>Trigger:</strong> {obj.trigger}
                </div>

                <div
                  style={{
                    padding: "0.6rem 0.8rem",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(15, 20, 28, 0.7)",
                    marginBottom: "0.6rem",
                    fontSize: "0.85rem",
                  }}
                >
                  <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>Underlying Concern: </span>
                  <span style={{ color: "var(--text-secondary)" }}>{obj.underlying_concern}</span>
                </div>

                <div
                  style={{
                    padding: "0.6rem 0.8rem",
                    borderRadius: "var(--radius-sm)",
                    background: "rgba(16, 185, 129, 0.08)",
                    border: "1px solid rgba(16, 185, 129, 0.2)",
                    fontSize: "0.85rem",
                  }}
                >
                  <span style={{ color: "var(--accent-emerald)", fontWeight: 600 }}>Counter-Strategy: </span>
                  <span style={{ color: "#d1fae5" }}>{obj.counter_strategy}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Strategic Questions Playbook */}
        <div>
          <div style={{ marginBottom: "1rem" }}>
            <h3 style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--text-gold)" }}>
              ⚡ Strategic Discovery Questions ({scenarios.strategic_questions.length})
            </h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              High-leverage questions to establish peer credibility and expose underlying pain.
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {scenarios.strategic_questions.map((q, i) => (
              <div
                key={i}
                className="glass-card"
                style={{
                  padding: "1.25rem",
                  background: "var(--bg-elevated)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <span className="badge badge-blue">
                    Phase: {q.phase.replace("_", " ")}
                  </span>
                  <button
                    className="btn btn-secondary"
                    onClick={() => copyToClipboard(q.question, i)}
                    style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem" }}
                  >
                    {copiedQuestionIdx === i ? "✓ Copied" : "📋 Copy"}
                  </button>
                </div>

                <p style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text-primary)", marginBottom: "0.75rem", lineHeight: 1.5 }}>
                  &quot;{q.question}&quot;
                </p>

                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: "0.4rem" }}>
                  <span style={{ color: "var(--accent-gold)", fontWeight: 600 }}>Why ask this: </span>
                  {q.rationale}
                </div>

                <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <span style={{ color: "var(--accent-cyan)", fontWeight: 600 }}>Listen for: </span>
                  {q.listen_for}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
