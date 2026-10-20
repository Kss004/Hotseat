"use client";

import React, { useState } from "react";
import type { PersonaRecord, RiskPosture, TechnicalDepth } from "@/types";
import { describeApiError, readJson } from "@/lib/apiErrors";

interface PersonaCardProps {
  sessionId: string;
  initialPersona: PersonaRecord;
  isContinuing: boolean;
  onContinue: () => void;
}

export function PersonaCard({ sessionId, initialPersona, isContinuing, onContinue }: PersonaCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [persona, setPersona] = useState<PersonaRecord>(initialPersona);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Form states for editing
  const [name, setName] = useState(initialPersona.name);
  const [title, setTitle] = useState(initialPersona.title);
  const [company, setCompany] = useState(initialPersona.company);
  const [background, setBackground] = useState(initialPersona.background);
  const [riskPosture, setRiskPosture] = useState<RiskPosture>(initialPersona.risk_posture as RiskPosture);
  const [technicalDepth, setTechnicalDepth] = useState<TechnicalDepth>(initialPersona.technical_depth as TechnicalDepth);
  const [conversationalStyle, setConversationalStyle] = useState(initialPersona.conversational_style);
  
  // Tag editors
  const [prioritiesStr, setPrioritiesStr] = useState(initialPersona.business_priorities.join("\n"));
  const [hotButtonsStr, setHotButtonsStr] = useState(initialPersona.hot_buttons.join("\n"));

  // Discards unsaved edits by resetting every draft field to the last saved persona
  const cancelEditing = () => {
    setName(persona.name);
    setTitle(persona.title);
    setCompany(persona.company);
    setBackground(persona.background);
    setRiskPosture(persona.risk_posture as RiskPosture);
    setTechnicalDepth(persona.technical_depth as TechnicalDepth);
    setConversationalStyle(persona.conversational_style);
    setPrioritiesStr(persona.business_priorities.join("\n"));
    setHotButtonsStr(persona.hot_buttons.join("\n"));
    setSaveMessage(null);
    setIsEditing(false);
  };

  const isUncertain = (field: string) => {
    return persona.uncertain_fields?.includes(field);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveMessage(null);

    const business_priorities = prioritiesStr
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const hot_buttons = hotButtonsStr
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (business_priorities.length === 0 || hot_buttons.length === 0) {
      setSaveMessage({ text: "Add at least one business priority and one hot button (one per line).", isError: true });
      setIsSaving(false);
      return;
    }

    const updatedData = {
      name: name.trim(),
      title: title.trim(),
      company: company.trim(),
      background: background.trim(),
      risk_posture: riskPosture,
      technical_depth: technicalDepth,
      business_priorities,
      hot_buttons,
      conversational_style: conversationalStyle.trim(),
      uncertain_fields: persona.uncertain_fields,
    };

    try {
      const res = await fetch(`/api/sessions/${sessionId}/persona`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedData),
      });

      const data = await readJson<{ persona: PersonaRecord; code?: string; message?: string }>(res);
      if (!res.ok || !data?.persona) {
        setSaveMessage({ text: describeApiError(data, "Failed to update persona").message, isError: true });
        return;
      }

      setPersona((prev) => ({
        ...prev,
        ...data.persona,
        edited_by_user: true,
      }));
      setIsEditing(false);
      setSaveMessage({ text: "Persona updated. The sparring partner will use your edits.", isError: false });
    } catch {
      setSaveMessage({ text: "Could not reach the server to save your edits.", isError: true });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="glass-card" style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
      {/* Header bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span className="badge badge-gold">Synthesized Persona Dossier</span>
            {persona.edited_by_user && (
              <span className="badge badge-blue">Edited by User</span>
            )}
          </div>
          <h2 style={{ fontSize: "1.6rem", fontWeight: 800 }}>
            {persona.name}
          </h2>
          <div style={{ color: "var(--text-secondary)", fontSize: "1rem" }}>
            {persona.title} • <span style={{ color: "var(--accent-gold)" }}>{persona.company}</span>
          </div>
        </div>

        <div>
          {!isEditing ? (
            <button
              className="btn btn-secondary"
              id="btn-edit-persona"
              onClick={() => setIsEditing(true)}
              style={{ fontSize: "0.85rem" }}
            >
              ✏️ Edit Persona
            </button>
          ) : (
            <button
              className="btn btn-secondary"
              onClick={cancelEditing}
              style={{ fontSize: "0.85rem" }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {saveMessage && (
        <div
          role={saveMessage.isError ? "alert" : "status"}
          style={{
            padding: "0.6rem 1rem",
            marginBottom: "1rem",
            borderRadius: "var(--radius-md)",
            fontSize: "0.85rem",
            background: saveMessage.isError ? "rgba(244, 63, 94, 0.15)" : "rgba(16, 185, 129, 0.15)",
            border: `1px solid ${saveMessage.isError ? "var(--accent-rose)" : "var(--accent-emerald)"}`,
            color: saveMessage.isError ? "#fecdd3" : "#a7f3d0",
          }}
        >
          {saveMessage.text}
        </div>
      )}

      {/* Uncertain fields alert */}
      {persona.uncertain_fields && persona.uncertain_fields.length > 0 && !isEditing && (
        <div
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1.5rem",
            borderRadius: "var(--radius-md)",
            background: "rgba(245, 158, 11, 0.12)",
            border: "1px solid rgba(245, 158, 11, 0.3)",
            fontSize: "0.85rem",
            color: "#fde68a",
          }}
        >
          <strong>⚠️ Inferred Fields Detected:</strong> The model inferred the following attributes without explicit textual proof:{" "}
          <span style={{ fontWeight: 600 }}>{persona.uncertain_fields.join(", ")}</span>. Please review or adjust them before proceeding.
        </div>
      )}

      {!isEditing ? (
        /* View Mode */
        <div>
          {/* Executive Overview */}
          <div style={{ marginBottom: "1.5rem" }}>
            <h4 style={{ fontSize: "0.8rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
              Career Foundation & Influence
            </h4>
            <p style={{ color: "var(--text-primary)", lineHeight: 1.6, fontSize: "0.95rem" }}>
              {persona.background}
            </p>
          </div>

          {/* Key Traits Grid */}
          <div className="grid-2" style={{ gap: "1rem", marginBottom: "1.5rem" }}>
            <div
              style={{
                padding: "1rem",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                <span style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--text-muted)" }}>Risk Posture</span>
                {isUncertain("risk_posture") && <span style={{ fontSize: "0.7rem", color: "var(--accent-amber)" }}>Inferred</span>}
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 700, color: persona.risk_posture === "risk_averse" ? "var(--accent-rose)" : "var(--accent-blue)" }}>
                {persona.risk_posture === "risk_averse"
                  ? "🛡️ Risk-Averse (Scrutinizes compliance & penalties)"
                  : persona.risk_posture === "aggressive"
                  ? "🚀 Aggressive / Growth-Oriented"
                  : "⚖️ Moderate / Balanced"}
              </div>
            </div>

            <div
              style={{
                padding: "1rem",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                <span style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--text-muted)" }}>Technical Depth</span>
                {isUncertain("technical_depth") && <span style={{ fontSize: "0.7rem", color: "var(--accent-amber)" }}>Inferred</span>}
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--accent-cyan)" }}>
                {persona.technical_depth === "high"
                  ? "💻 High (Probes architecture & data security)"
                  : persona.technical_depth === "low"
                  ? "📊 Low (Strictly commercial & strategic)"
                  : "⚙️ Moderate (Functional technical literacy)"}
              </div>
            </div>
          </div>

          {/* Priorities & Hot Buttons */}
          <div className="grid-2" style={{ gap: "1.5rem", marginBottom: "1.5rem" }}>
            <div>
              <h4 style={{ fontSize: "0.8rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
                Top Business Priorities
              </h4>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {persona.business_priorities.map((item, idx) => (
                  <li
                    key={idx}
                    style={{
                      padding: "0.45rem 0.75rem",
                      background: "rgba(16, 185, 129, 0.08)",
                      border: "1px solid rgba(16, 185, 129, 0.2)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "0.85rem",
                      color: "#d1fae5",
                    }}
                  >
                    ✓ {item}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h4 style={{ fontSize: "0.8rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: "0.5rem" }}>
                Hot Buttons & Pet Peeves
              </h4>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {persona.hot_buttons.map((item, idx) => (
                  <li
                    key={idx}
                    style={{
                      padding: "0.45rem 0.75rem",
                      background: "rgba(244, 63, 94, 0.08)",
                      border: "1px solid rgba(244, 63, 94, 0.2)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "0.85rem",
                      color: "#ffe4e6",
                    }}
                  >
                    ⚡ {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Conversational Style */}
          <div style={{ marginBottom: "2rem" }}>
            <h4 style={{ fontSize: "0.8rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em", marginBottom: "0.4rem" }}>
              Conversational Style
            </h4>
            <div
              style={{
                padding: "0.75rem 1rem",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                fontSize: "0.9rem",
                color: "var(--text-primary)",
              }}
            >
              &quot;{persona.conversational_style}&quot;
            </div>
          </div>

          {/* Action Footer */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem", borderTop: "1px solid var(--border-subtle)", paddingTop: "1.5rem" }}>
            <button
              type="button"
              className="btn btn-primary"
              id="btn-confirm-persona"
              onClick={onContinue}
              disabled={isContinuing}
              style={{ padding: "0.85rem 1.75rem", fontSize: "0.95rem" }}
            >
              {isContinuing ? "Mapping scenarios…" : "Confirm Persona & Map Scenarios →"}
            </button>
          </div>
        </div>
      ) : (
        /* Edit Mode */
        <form onSubmit={handleSave}>
          <div className="grid-2" style={{ gap: "1rem", marginBottom: "1rem" }}>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                type="text"
                className="form-control"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Executive Title</label>
              <input
                type="text"
                className="form-control"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Company / Organization</label>
            <input
              type="text"
              className="form-control"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Career Background</label>
            <textarea
              rows={3}
              className="form-control"
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              required
            />
          </div>

          <div className="grid-2" style={{ gap: "1rem", marginBottom: "1rem" }}>
            <div className="form-group">
              <label className="form-label">Risk Posture</label>
              <select
                className="form-control"
                value={riskPosture}
                onChange={(e) => setRiskPosture(e.target.value as RiskPosture)}
              >
                <option value="risk_averse">Risk-Averse (Default for compliance/risk)</option>
                <option value="moderate">Moderate / Pragmatic</option>
                <option value="aggressive">Aggressive / Growth-Focused</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Technical Depth</label>
              <select
                className="form-control"
                value={technicalDepth}
                onChange={(e) => setTechnicalDepth(e.target.value as TechnicalDepth)}
              >
                <option value="high">High (Architecture & Security)</option>
                <option value="moderate">Moderate (Functional)</option>
                <option value="low">Low (Executive / Commercial only)</option>
              </select>
            </div>
          </div>

          <div className="grid-2" style={{ gap: "1rem", marginBottom: "1rem" }}>
            <div className="form-group">
              <label className="form-label">Business Priorities (One per line)</label>
              <textarea
                rows={4}
                className="form-control"
                value={prioritiesStr}
                onChange={(e) => setPrioritiesStr(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Hot Buttons (One per line)</label>
              <textarea
                rows={4}
                className="form-control"
                value={hotButtonsStr}
                onChange={(e) => setHotButtonsStr(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: "1.5rem" }}>
            <label className="form-label">Conversational Style</label>
            <input
              type="text"
              className="form-control"
              value={conversationalStyle}
              onChange={(e) => setConversationalStyle(e.target.value)}
              required
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={cancelEditing}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              id="btn-save-persona-edits"
              disabled={isSaving}
            >
              {isSaving ? "Saving..." : "Save Persona Changes"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
