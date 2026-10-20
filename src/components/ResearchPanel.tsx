"use client";

import React from "react";
import type { ResearchRecord } from "@/types";

interface ResearchPanelProps {
  research: ResearchRecord | null;
}

/** Tavily dates come as ISO dates or RFC 1123 strings; show "14 Sep 2026" when parseable. */
function formatDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** Live company research shown above the objection map. Hidden when research isn't configured. */
export function ResearchPanel({ research }: ResearchPanelProps) {
  if (!research || research.status === "not_configured") return null;

  const findings = research.findings.filter((f) => isHttpUrl(f.url));
  const hasFindings = research.status === "ok" && findings.length > 0;

  return (
    <div className="glass-card" id="research-panel" style={{ padding: "1.25rem 1.5rem", marginBottom: "2rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: hasFindings ? "0.25rem" : 0 }}>
        <h3 style={{ fontSize: "1.05rem", fontWeight: 700 }}>🌐 Live Company Research</h3>
        {hasFindings && <span className="badge badge-emerald">{findings.length} sources</span>}
        {research.cached && <span className="badge badge-blue">From the last 24h</span>}
      </div>

      {hasFindings ? (
        <>
          <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1rem" }}>
            Recent public coverage used to tailor the objections below and the counterpart&apos;s replies. Check the sources
            before relying on them.
          </p>
          <ul style={{ listStyle: "none", display: "grid", gap: "0.75rem", padding: 0, margin: 0 }}>
            {findings.map((f) => (
              <li
                key={f.url}
                style={{
                  padding: "0.75rem 1rem",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--border-subtle)",
                  background: "var(--bg-elevated)",
                }}
              >
                <a
                  href={f.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "0.9rem", textDecoration: "none" }}
                >
                  {f.title} ↗
                </a>
                <div style={{ color: "var(--text-muted)", fontSize: "0.75rem", margin: "0.15rem 0 0.35rem" }}>
                  {f.source}
                  {formatDate(f.published_date) ? ` · ${formatDate(f.published_date)}` : ""}
                </div>
                <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", lineHeight: 1.5 }}>{f.snippet}</p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", marginTop: "0.35rem" }}>
          {research.reason || "No live research for this briefing."} The briefing below is based on the profile you provided.
        </p>
      )}
    </div>
  );
}
