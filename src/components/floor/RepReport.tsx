"use client";

import React, { useEffect, useState } from "react";
import { readJson } from "@/lib/apiErrors";
import { AnalyticsReport } from "@/components/AnalyticsReport";
import type { EvaluationRecord, PersonaRecord, Turn } from "@/types";

interface Report {
  rep_name: string;
  scheduled_at: string;
  call_status: string;
  duration_sec: number | null;
  eval_status: string;
  eval_error: string | null;
  recording_url: string | null;
  objection_plan: { category: string; objection: string }[];
  persona: PersonaRecord | null;
  evaluation: EvaluationRecord | null;
  turns: Turn[];
}

export function RepReport({ token }: { token: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/floor/report/${encodeURIComponent(token)}`);
      const data = await readJson<{ report?: Report; message?: string }>(res);
      if (!res.ok || !data?.report) setError(data?.message || "This report could not be loaded.");
      else setReport(data.report);
    })();
  }, [token]);

  if (error) return <main className="container" style={{ padding: "3rem 1rem" }}><div className="floor-error">{error}</div></main>;
  if (!report) return <main className="container" style={{ padding: "3rem 1rem" }}><p className="floor-muted">Loading report…</p></main>;

  const when = new Date(report.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  return (
    <main className="container" style={{ padding: "1.5rem 1rem 4rem" }}>
      <div className="glass-card floor-section">
        <h1 style={{ fontSize: "1.4rem", fontWeight: 800 }}>{report.rep_name}&apos;s practice call</h1>
        <p className="floor-muted">
          {when} IST{report.persona ? ` · with ${report.persona.name}, ${report.persona.title} at ${report.persona.company} (AI practice buyer)` : ""}
          {report.duration_sec ? ` · ${Math.round(report.duration_sec)}s` : ""}
        </p>
        {report.recording_url && (
          <p style={{ marginTop: "0.5rem" }}>
            <a href={report.recording_url} target="_blank" rel="noreferrer" style={{ color: "var(--accent-gold)" }}>Listen to the recording</a>
          </p>
        )}
        {report.objection_plan.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <p className="floor-muted">The buyer planned to push on:</p>
            <ul style={{ paddingLeft: "1.2rem", fontSize: "0.9rem" }}>
              {report.objection_plan.map((o, i) => (
                <li key={i}><strong>{o.category}:</strong> {o.objection}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {report.evaluation && report.persona ? (
        <AnalyticsReport evaluation={report.evaluation} persona={report.persona} />
      ) : (
        <div className="glass-card floor-section">
          <h2>Not scored</h2>
          <p className="floor-muted">
            {report.eval_status === "pending" || report.eval_status === "scoring"
              ? "This call is being scored. Refresh in a minute."
              : report.eval_error || "This call has no score."}
          </p>
        </div>
      )}

      {report.turns.length > 0 && (
        <div className="glass-card floor-section">
          <h2>Transcript</h2>
          <p className="floor-muted" style={{ marginBottom: "0.5rem" }}>As transcribed during the call. Quotes in the report were matched against this text.</p>
          {report.turns.map((t) => (
            <div key={t.id} className="floor-turn">
              <strong style={{ color: t.role === "user" ? "var(--accent-gold)" : "var(--accent-cyan)" }}>
                {t.role === "user" ? report.rep_name : report.persona?.name || "Buyer"}:
              </strong>{" "}
              {t.content}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
