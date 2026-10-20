"use client";

import React, { useRef, useState } from "react";
import type { Session, PersonaRecord } from "@/types";
import { describeApiError, readJson } from "@/lib/apiErrors";
import marcusFixture from "../../fixtures/marcus-vance.json";

// Keeps prompts (and free-tier token use) bounded; the API accepts up to 20,000 including the optional hints
const MAX_BIO_CHARS = 12000;

interface IngestionFormProps {
  onSuccess: (session: Session, persona: PersonaRecord) => void;
}

export function IngestionForm({ onSuccess }: IngestionFormProps) {
  const [profileText, setProfileText] = useState("");
  const [linkedInUrl, setLinkedInUrl] = useState("");
  const [roleHint, setRoleHint] = useState("");
  const [industryHint, setIndustryHint] = useState("");
  const [tenureHint, setTenureHint] = useState("");
  const [prioritiesHint, setPrioritiesHint] = useState("");

  const [productSummary, setProductSummary] = useState("");
  const [meetingGoal, setMeetingGoal] = useState("");
  const [meetingType, setMeetingType] = useState("Enterprise Sales Pitch");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [difficulty, setDifficulty] = useState<"warmup" | "realistic" | "hostile">("realistic");
  const [webResearch, setWebResearch] = useState(true);

  const [isScraping, setIsScraping] = useState(false);
  const [scrapeError, setScrapeError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const pendingSession = useRef<{ payload: string; session: Session } | null>(null);
  // Focused when a LinkedIn fetch fails, so the user lands on the paste box
  const profileRef = useRef<HTMLTextAreaElement>(null);

  // Load Seeded PRD Fixture: Marcus Vance, MD (fictional benchmark persona)
  const loadSeededFixture = () => {
    const data = marcusFixture;
    setProfileText(data.raw_input);
    setLinkedInUrl(data.target_url || "");
    setRoleHint(data.hints?.role || "");
    setIndustryHint(data.hints?.industry || "");
    setTenureHint(data.hints?.tenure || "");
    setPrioritiesHint(data.hints?.known_priorities || "");
    setProductSummary(data.meeting_context.product_summary);
    setMeetingGoal(data.meeting_context.goal);
    setMeetingType(data.meeting_context.meeting_type);
    setDurationMinutes(data.meeting_context.duration_minutes);
    setDifficulty(data.difficulty as "warmup" | "realistic" | "hostile");
    setScrapeError(null);
    setFormError(null);
  };

  // Best-effort LinkedIn scrape
  const handleScrapeLinkedIn = async () => {
    if (!linkedInUrl.trim()) return;
    setIsScraping(true);
    setScrapeError(null);

    try {
      const res = await fetch("/api/ingest/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: linkedInUrl.trim() }),
      });

      const data = await res.json();
      if (data.ok && data.text) {
        setProfileText((prev) => {
          if (!prev.trim()) return data.text;
          return `${prev}\n\n[Scraped Profile Details]:\n${data.text}`;
        });
      } else {
        setScrapeError(data.reason || "Couldn't read this profile. Paste the text instead.");
        profileRef.current?.focus();
      }
    } catch {
      setScrapeError("Couldn't read this profile. Paste the text instead.");
      profileRef.current?.focus();
    } finally {
      setIsScraping(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    let combinedRawInput = profileText.trim();
    if (roleHint || industryHint || tenureHint || prioritiesHint) {
      combinedRawInput += `\n\n[Additional Context Notes]:\n`;
      if (roleHint) combinedRawInput += `- Role: ${roleHint}\n`;
      if (industryHint) combinedRawInput += `- Industry: ${industryHint}\n`;
      if (tenureHint) combinedRawInput += `- Tenure: ${tenureHint}\n`;
      if (prioritiesHint) combinedRawInput += `- Known Priorities: ${prioritiesHint}\n`;
    }

    if (combinedRawInput.length < 80) {
      setFormError("Profile context must be at least 80 characters long.");
      return;
    }

    if (!productSummary.trim() || !meetingGoal.trim()) {
      setFormError("Product summary and meeting goal are required.");
      return;
    }

    setIsSubmitting(true);

    const payload = JSON.stringify({
      title: `Prep: ${roleHint || "Executive Counterpart"}`,
      target_url: linkedInUrl.trim() || null,
      raw_input: combinedRawInput,
      meeting_context: {
        product_summary: productSummary.trim(),
        goal: meetingGoal.trim(),
        meeting_type: meetingType,
        duration_minutes: durationMinutes,
        web_research: webResearch,
      },
      difficulty,
    });

    try {
      // 1. Create the session, unless a previous attempt already created one for these exact inputs
      let session = pendingSession.current?.payload === payload ? pendingSession.current.session : null;
      if (!session) {
        const sessionRes = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
        const sessionData = await readJson<{ session: Session; code?: string; message?: string }>(sessionRes);
        if (!sessionRes.ok || !sessionData?.session) {
          setFormError(describeApiError(sessionData, "Failed to create session").message);
          return;
        }
        session = sessionData.session;
        pendingSession.current = { payload, session };
      }

      // 2. Generate Persona
      const personaRes = await fetch(`/api/sessions/${session.id}/persona`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const personaData = await readJson<{ persona: PersonaRecord; code?: string; message?: string }>(personaRes);
      if (!personaRes.ok || !personaData?.persona) {
        const err = describeApiError(personaData, "Failed to generate persona");
        setFormError(err.retryable ? `${err.message} Press Generate again to retry.` : err.message);
        return;
      }

      pendingSession.current = null;
      onSuccess(session, personaData.persona);
    } catch {
      setFormError("Could not reach the server. Check that it is running and retry.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const charCount = profileText.length;
  // Shown next to the Generate button so a disabled button always says why
  const missing = [
    charCount < 80 ? `${80 - charCount} more characters of background` : null,
    !productSummary.trim() ? "a product summary" : null,
    !meetingGoal.trim() ? "a meeting goal" : null,
  ].filter((m): m is string => m !== null);

  return (
    <div className="glass-card" style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.25rem" }}>
            Target Ingestion & Meeting Context
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
            Paste the counterpart&apos;s background and specify your meeting parameters.
          </p>
        </div>

        <button
          type="button"
          onClick={loadSeededFixture}
          className="btn btn-secondary"
          id="btn-load-md-fixture"
          style={{ fontSize: "0.8rem", padding: "0.5rem 0.9rem", border: "1px solid var(--accent-gold)" }}
        >
          ⚡ Load Marcus Vance (MD Benchmark)
        </button>
      </div>

      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "1.5rem", fontStyle: "italic" }}>
        * The Marcus Vance profile and Apex Financial Capital are fictional entities created for benchmark simulation testing.
      </div>

      {formError && (
        <div
          role="alert"
          style={{
            background: "rgba(244, 63, 94, 0.15)",
            border: "1px solid var(--accent-rose)",
            color: "#fecdd3",
            padding: "0.75rem 1rem",
            borderRadius: "var(--radius-md)",
            marginBottom: "1.5rem",
            fontSize: "0.9rem",
          }}
        >
          {formError}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Section 1: Counterpart Background */}
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
            <label className="form-label" htmlFor="profile-text">
              Counterpart&apos;s Profile <span style={{ color: "var(--accent-rose)" }}>*</span>
            </label>
            <span style={{ fontSize: "0.75rem", color: charCount >= 80 ? "var(--accent-emerald)" : "var(--accent-amber)" }}>
              {charCount.toLocaleString()} chars · 80 min · {MAX_BIO_CHARS.toLocaleString()} max
            </span>
          </div>

          <div id="profile-text-help" style={{ color: "var(--text-secondary)", fontSize: "0.8rem", marginBottom: "0.5rem" }}>
            Open their LinkedIn profile, copy the <strong>About</strong> and <strong>Experience</strong> sections, and paste
            them here. A company bio, press release or your own notes work too.
          </div>

          <textarea
            ref={profileRef}
            id="profile-text"
            rows={5}
            className="form-control"
            placeholder="e.g. Head of Operational Risk at a UK bank. 15 years in risk and controls, previously led SOX reviews at a Big Four firm. Owns operational resilience and third-party risk..."
            aria-describedby="profile-text-help"
            value={profileText}
            onChange={(e) => setProfileText(e.target.value)}
            maxLength={MAX_BIO_CHARS}
            style={{ width: "100%", resize: "vertical" }}
            aria-required="true"
          />

          {/* Optional LinkedIn URL */}
          <div style={{ marginTop: "1rem" }}>
            <label className="form-label" htmlFor="linkedin-url">
              LinkedIn Profile URL (optional extra)
            </label>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                id="linkedin-url"
                type="url"
                className="form-control"
                placeholder="https://www.linkedin.com/in/username"
                value={linkedInUrl}
                onChange={(e) => setLinkedInUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleScrapeLinkedIn();
                  }
                }}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                id="btn-fetch-linkedin"
                onClick={handleScrapeLinkedIn}
                disabled={isScraping || !linkedInUrl.trim()}
              >
                {isScraping ? "Fetching..." : "Fetch Snippet"}
              </button>
            </div>

            <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginTop: "0.35rem" }}>
              LinkedIn hides most profiles from automated requests, so this usually can&apos;t read the profile. When it can,
              it adds the public headline and summary to the text above. Pasting, as described above, always works.
            </div>

            {scrapeError && (
              <div role="status" style={{ color: "var(--accent-amber)", fontSize: "0.8rem", marginTop: "0.4rem" }}>
                ⚠️ {scrapeError}
              </div>
            )}
          </div>

          {/* Context Hints Grid */}
          <div className="grid-2" style={{ gap: "1rem", marginTop: "1rem" }}>
            <div>
              <label className="form-label" htmlFor="role-hint">Role / Seniority (Optional)</label>
              <input
                id="role-hint"
                type="text"
                className="form-control"
                placeholder="e.g. Managing Director, Operational Risk"
                value={roleHint}
                onChange={(e) => setRoleHint(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="industry-hint">Industry / Domain (Optional)</label>
              <input
                id="industry-hint"
                type="text"
                className="form-control"
                placeholder="e.g. Tier-1 Financial Services"
                value={industryHint}
                onChange={(e) => setIndustryHint(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </div>

        {/* Section 2: Meeting Context */}
        <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1.5rem", marginBottom: "2rem" }}>
          <h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem", color: "var(--text-gold)" }}>
            Meeting Agenda & Stakes
          </h3>

          <div className="form-group">
            <label className="form-label" htmlFor="product-summary">
              Product / Offering Summary <span style={{ color: "var(--accent-rose)" }}>*</span>
            </label>
            <textarea
              id="product-summary"
              rows={3}
              className="form-control"
              placeholder="What are you pitching? Mention security certifications, deployment models, and core value prop..."
              value={productSummary}
              onChange={(e) => setProductSummary(e.target.value)}
              aria-required="true"
            />
          </div>

          <div className="grid-split-wide" style={{ gap: "1rem" }}>
            <div className="form-group">
              <label className="form-label" htmlFor="meeting-goal">
                Specific Meeting Goal <span style={{ color: "var(--accent-rose)" }}>*</span>
              </label>
              <input
                id="meeting-goal"
                type="text"
                className="form-control"
                placeholder="e.g. Secure a 60-day sandbox pilot with the risk committee"
                value={meetingGoal}
                onChange={(e) => setMeetingGoal(e.target.value)}
                aria-required="true"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="duration-minutes">
                Duration (Minutes)
              </label>
              <select
                id="duration-minutes"
                className="form-control"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
              >
                <option value={15}>15 min (Elevator/Briefing)</option>
                <option value={30}>30 min (Standard Pitch)</option>
                <option value={45}>45 min (Executive Review)</option>
                <option value={60}>60 min (Deep Dive)</option>
              </select>
            </div>
          </div>

          {/* Live research opt-out (only takes effect when the server has a Tavily key) */}
          <label
            htmlFor="web-research"
            style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", marginBottom: "1.25rem", cursor: "pointer" }}
          >
            <input
              id="web-research"
              type="checkbox"
              checked={webResearch}
              onChange={(e) => setWebResearch(e.target.checked)}
              style={{ marginTop: "0.2rem" }}
            />
            <span>
              <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Use live web research on their company</span>
              <span style={{ display: "block", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                Searches recent public news about the company (not the person) to sharpen the objections. Sources are shown
                on the briefing.
              </span>
            </span>
          </label>

          {/* Difficulty Selector */}
          <div className="form-group" style={{ marginTop: "0.5rem" }}>
            <label className="form-label">Simulation Sparring Difficulty</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem", marginTop: "0.25rem" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.6rem 0.8rem",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${difficulty === "warmup" ? "var(--accent-blue)" : "var(--border-subtle)"}`,
                  background: difficulty === "warmup" ? "rgba(59, 130, 246, 0.1)" : "var(--bg-elevated)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                <input
                  type="radio"
                  name="difficulty"
                  value="warmup"
                  checked={difficulty === "warmup"}
                  onChange={() => setDifficulty("warmup")}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>Warm-up</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Supportive, forgiving</div>
                </div>
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.6rem 0.8rem",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${difficulty === "realistic" ? "var(--accent-gold)" : "var(--border-subtle)"}`,
                  background: difficulty === "realistic" ? "rgba(229, 169, 60, 0.1)" : "var(--bg-elevated)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                <input
                  type="radio"
                  name="difficulty"
                  value="realistic"
                  checked={difficulty === "realistic"}
                  onChange={() => setDifficulty("realistic")}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>Realistic</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Sharp, cynical, pragmatic</div>
                </div>
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.6rem 0.8rem",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${difficulty === "hostile" ? "var(--accent-rose)" : "var(--border-subtle)"}`,
                  background: difficulty === "hostile" ? "rgba(244, 63, 94, 0.1)" : "var(--bg-elevated)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                <input
                  type="radio"
                  name="difficulty"
                  value="hostile"
                  checked={difficulty === "hostile"}
                  onChange={() => setDifficulty("hostile")}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>Hostile</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>High pressure, impatient</div>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Submit Button */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          {missing.length > 0 && !isSubmitting && (
            <span id="generate-hint" style={{ fontSize: "0.8rem", color: "var(--accent-amber)" }}>
              Still needed: {missing.join(", ")}.
            </span>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            id="btn-generate-persona"
            aria-describedby={missing.length > 0 ? "generate-hint" : undefined}
            disabled={isSubmitting || missing.length > 0}
            style={{ minWidth: "220px", padding: "0.85rem 1.5rem" }}
          >
            {isSubmitting ? "Synthesizing Persona..." : "Generate Persona Card →"}
          </button>
        </div>
      </form>
    </div>
  );
}
