"use client";

import React, { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { IngestionForm } from "@/components/IngestionForm";
import { PersonaCard } from "@/components/PersonaCard";
import { BriefingView } from "@/components/BriefingView";
import { SparringArena } from "@/components/SparringArena";
import { AnalyticsReport } from "@/components/AnalyticsReport";
import type { Session, PersonaRecord, ScenariosRecord, Turn, EvaluationRecord } from "@/types";
import { describeApiError, readJson } from "@/lib/apiErrors";

type WorkflowStage = "ingest" | "persona" | "briefing" | "sparring" | "analytics";

export default function Home() {
  const [stage, setStage] = useState<WorkflowStage>("ingest");
  const [session, setSession] = useState<Session | null>(null);
  const [persona, setPersona] = useState<PersonaRecord | null>(null);
  const [scenarios, setScenarios] = useState<ScenariosRecord | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [evaluation, setEvaluation] = useState<EvaluationRecord | null>(null);
  const [isLoadingScenarios, setIsLoadingScenarios] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  // True until the ?session= lookup finishes, so the ingest form doesn't flash before a saved stage
  const [isRestoring, setIsRestoring] = useState(true);
  const [globalError, setGlobalError] = useState<{ message: string; retry?: () => void } | null>(null);

  // Check URL on load for session resume: ?session=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get("session");
    if (sid) {
      loadExistingSession(sid).finally(() => setIsRestoring(false));
    } else {
      setIsRestoring(false);
    }
    const onPopState = () => window.location.reload();
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadExistingSession = async (sid: string) => {
    try {
      const res = await fetch(`/api/sessions/${sid}`);
      const data = await readJson<{
        ok: boolean;
        session: Session;
        persona: PersonaRecord | null;
        scenarios: ScenariosRecord | null;
        turns: Turn[];
        evaluation: EvaluationRecord | null;
        code?: string;
        message?: string;
      }>(res);
      if (!res.ok || !data?.ok) {
        setGlobalError({ message: `${describeApiError(data, "Could not restore that session.").message} Starting a new preparation instead.` });
        return;
      }
      {
        setSession(data.session);
        if (data.persona) setPersona(data.persona);
        if (data.scenarios) setScenarios(data.scenarios);
        if (data.turns) setTurns(data.turns);
        if (data.evaluation) setEvaluation(data.evaluation);

        if (data.evaluation) {
          setStage("analytics");
        } else if (data.session.status === "roleplay_active" || data.session.status === "ended") {
          setStage("sparring");
        } else if (data.scenarios) {
          setStage("briefing");
        } else if (data.persona) {
          setStage("persona");
        } else {
          setGlobalError({ message: "This session never got a persona (generation failed). Fill in the form to start again." });
        }
      }
    } catch {
      setGlobalError({ message: "Could not reach the server to restore your session." });
    }
  };

  const updateUrlSessionId = (sid: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("session", sid);
    window.history.pushState({}, "", url.toString());
  };

  const handleIngestSuccess = (newSession: Session, newPersona: PersonaRecord) => {
    setSession(newSession);
    setPersona(newPersona);
    setStage("persona");
    updateUrlSessionId(newSession.id);
  };

  const handleConfirmPersona = async () => {
    if (!session || !persona || isLoadingScenarios) return;
    setIsLoadingScenarios(true);
    setGlobalError(null);

    try {
      const res = await fetch(`/api/sessions/${session.id}/scenarios`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await readJson<{ scenarios: ScenariosRecord; code?: string; message?: string }>(res);
      if (!res.ok || !data?.scenarios) {
        const err = describeApiError(data, "Failed to generate the scenario briefing.");
        setGlobalError({ message: err.message, retry: err.retryable ? handleConfirmPersona : undefined });
        return;
      }

      setScenarios(data.scenarios);
      setStage("briefing");
    } catch {
      setGlobalError({ message: "Could not reach the server.", retry: handleConfirmPersona });
    } finally {
      setIsLoadingScenarios(false);
    }
  };

  const handleStartSparring = () => {
    setStage("sparring");
  };

  const handleEndSimulation = async () => {
    if (!session || isEvaluating) return;
    setIsEvaluating(true);
    setGlobalError(null);

    try {
      // The evaluate route closes the session on success, so a failed evaluation leaves sparring open
      const res = await fetch(`/api/sessions/${session.id}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await readJson<{ evaluation: EvaluationRecord; code?: string; message?: string }>(res);
      if (!res.ok || !data?.evaluation) {
        const err = describeApiError(data, "Failed to evaluate your performance.");
        setGlobalError({ message: err.message, retry: err.retryable ? handleEndSimulation : undefined });
        return;
      }

      setEvaluation(data.evaluation);
      setStage("analytics");
    } catch {
      setGlobalError({ message: "Could not reach the server.", retry: handleEndSimulation });
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleNewSession = () => {
    setSession(null);
    setPersona(null);
    setScenarios(null);
    setTurns([]);
    setEvaluation(null);
    setStage("ingest");
    setGlobalError(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    window.history.pushState({}, "", url.toString());
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Header onNewSession={stage !== "ingest" ? handleNewSession : undefined} />

      {/* Breadcrumb Stepper */}
      <nav
        aria-label="Workflow progress"
        style={{
          borderBottom: "1px solid var(--border-subtle)",
          background: "rgba(15, 20, 28, 0.4)",
          padding: "0.75rem 0",
        }}
      >
        <div
          className="container"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.5rem",
            fontSize: "0.85rem",
            fontWeight: 600,
            flexWrap: "wrap",
          }}
        >
          <span
            aria-current={stage === "ingest" ? "step" : undefined}
            style={{ color: stage === "ingest" ? "var(--accent-gold)" : "var(--text-muted)" }}
          >
            1. Ingestion & Context
          </span>
          <span style={{ color: "var(--border-medium)" }}>→</span>
          <span
            aria-current={stage === "persona" ? "step" : undefined}
            style={{ color: stage === "persona" ? "var(--accent-gold)" : "var(--text-muted)" }}
          >
            2. Persona Dossier
          </span>
          <span style={{ color: "var(--border-medium)" }}>→</span>
          <span
            aria-current={stage === "briefing" ? "step" : undefined}
            style={{ color: stage === "briefing" ? "var(--accent-gold)" : "var(--text-muted)" }}
          >
            3. Tactical Briefing
          </span>
          <span style={{ color: "var(--border-medium)" }}>→</span>
          <span
            aria-current={stage === "sparring" ? "step" : undefined}
            style={{ color: stage === "sparring" ? "var(--accent-gold)" : "var(--text-muted)" }}
          >
            4. Live Sparring Arena
          </span>
          <span style={{ color: "var(--border-medium)" }}>→</span>
          <span
            aria-current={stage === "analytics" ? "step" : undefined}
            style={{ color: stage === "analytics" ? "var(--accent-gold)" : "var(--text-muted)" }}
          >
            5. Performance Report
          </span>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="container" style={{ flex: 1, padding: "2.5rem 1.5rem" }}>
        {globalError && (
          <div
            role="alert"
            style={{
              maxWidth: "900px",
              margin: "0 auto 1.5rem",
              padding: "0.75rem 1.25rem",
              background: "rgba(244, 63, 94, 0.15)",
              border: "1px solid var(--accent-rose)",
              borderRadius: "var(--radius-md)",
              color: "#fecdd3",
              fontSize: "0.9rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "1rem",
              flexWrap: "wrap",
            }}
          >
            <span>⚠️ {globalError.message}</span>
            <span style={{ display: "flex", gap: "0.5rem" }}>
              {globalError.retry && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  id="btn-global-retry"
                  onClick={globalError.retry}
                  disabled={isEvaluating || isLoadingScenarios}
                  style={{ fontSize: "0.8rem", padding: "0.35rem 0.8rem" }}
                >
                  ↻ Retry
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary"
                aria-label="Dismiss error"
                onClick={() => setGlobalError(null)}
                style={{ fontSize: "0.8rem", padding: "0.35rem 0.6rem" }}
              >
                ✕
              </button>
            </span>
          </div>
        )}

        {isRestoring && (
          <div role="status" style={{ textAlign: "center", padding: "4rem 1rem", color: "var(--text-muted)" }}>
            Restoring your session…
          </div>
        )}

        {!isRestoring && stage === "ingest" && <IngestionForm onSuccess={handleIngestSuccess} />}

        {stage === "persona" && persona && session && (
          <div>
            <PersonaCard
              sessionId={session.id}
              initialPersona={persona}
              isContinuing={isLoadingScenarios}
              onContinue={handleConfirmPersona}
            />
            {isLoadingScenarios && (
              <div style={{ textAlign: "center", marginTop: "1.5rem", color: "var(--accent-gold)" }}>
                ⚡ Mapping predictive objections and strategic questions...
              </div>
            )}
          </div>
        )}

        {stage === "briefing" && scenarios && session && (
          <BriefingView
            scenarios={scenarios}
            difficulty={session.difficulty}
            onStartSparring={handleStartSparring}
          />
        )}

        {stage === "sparring" && session && persona && (
          <div>
            <SparringArena
              sessionId={session.id}
              persona={persona}
              difficulty={session.difficulty}
              maxTurns={session.max_turns}
              initialTurns={turns}
              isEvaluating={isEvaluating}
              onEndSimulation={handleEndSimulation}
            />
            {isEvaluating && (
              <div style={{ textAlign: "center", marginTop: "1.5rem", color: "var(--accent-gold)" }}>
                📊 Evaluating executive clarity, evidence, and generating gold-standard rewrites...
              </div>
            )}
          </div>
        )}

        {stage === "analytics" && evaluation && persona && (
          <AnalyticsReport
            evaluation={evaluation}
            persona={persona}
            onNewSession={handleNewSession}
          />
        )}
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border-subtle)",
          padding: "1.5rem 0",
          textAlign: "center",
          fontSize: "0.8rem",
          color: "var(--text-muted)",
        }}
      >
        <div className="container">
          AI-Powered Role-Play Preparation Coach • Executive Sparring Engine • SQLite Persistence with libSQL
        </div>
      </footer>
    </div>
  );
}
