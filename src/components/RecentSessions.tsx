"use client";

import React, { useEffect, useState } from "react";
import { clearRecentSessions, forgetSession, listRecentSessions, type RecentSession } from "@/lib/recentSessions";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Recent sessions stored in this browser, shown under the ingestion form. Hidden when there are none. */
export function RecentSessions() {
  // Read after mount: localStorage doesn't exist during server rendering
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  useEffect(() => setSessions(listRecentSessions()), []);

  if (sessions.length === 0) return null;

  const remove = (id: string) => {
    forgetSession(id);
    setSessions(listRecentSessions());
  };

  return (
    <div className="glass-card" id="recent-sessions" style={{ padding: "1.25rem 1.5rem", marginTop: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "0.25rem" }}>
        <h3 style={{ fontSize: "1rem", fontWeight: 700 }}>Your recent sessions</h3>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            clearRecentSessions();
            setSessions([]);
          }}
          style={{ fontSize: "0.75rem", padding: "0.35rem 0.75rem" }}
        >
          Clear list
        </button>
      </div>
      <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginBottom: "0.75rem" }}>
        Saved only in this browser. Clearing the list doesn&apos;t delete the sessions.
      </p>

      <ul style={{ listStyle: "none", display: "grid", gap: "0.5rem", padding: 0, margin: 0 }}>
        {sessions.map((s) => (
          <li
            key={s.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              padding: "0.6rem 0.85rem",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-elevated)",
            }}
          >
            <a href={`/?session=${encodeURIComponent(s.id)}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}>
              <div style={{ fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.counterpart}
                {s.company ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · {s.company}</span> : null}
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>{formatDate(s.createdAt)}</div>
            </a>
            {typeof s.score === "number" ? (
              <span className="badge badge-gold">{s.score.toFixed(1)} / 10</span>
            ) : (
              <span className="badge badge-blue">In progress</span>
            )}
            <button
              type="button"
              aria-label={`Remove ${s.counterpart} from the list`}
              onClick={() => remove(s.id)}
              style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "1rem" }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
