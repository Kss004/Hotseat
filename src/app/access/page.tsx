"use client";

import React, { useState } from "react";
import { Header } from "@/components/Header";
import { describeApiError, readJson } from "@/lib/apiErrors";
import { safeNextPath } from "@/lib/access";

export default function AccessPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (res.ok) {
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.assign(safeNextPath(next));
        return;
      }
      setError(describeApiError(await readJson(res), "Could not check the access code.").message);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    }
    setIsSubmitting(false);
  };

  return (
    <>
      <Header />
      <main className="container" style={{ display: "flex", justifyContent: "center", padding: "4rem 1rem" }}>
        <form className="glass-card" onSubmit={handleSubmit} style={{ width: "100%", maxWidth: "420px", padding: "2rem" }}>
          <h2 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "0.25rem" }}>Enter access code</h2>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            This demo is private. Use the access code you were given.
          </p>

          {error && (
            <div
              role="alert"
              style={{
                background: "rgba(244, 63, 94, 0.15)",
                border: "1px solid var(--accent-rose)",
                color: "#fecdd3",
                padding: "0.75rem 1rem",
                borderRadius: "var(--radius-md)",
                marginBottom: "1rem",
                fontSize: "0.9rem",
              }}
            >
              {error}
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="access-code">
              Access code
            </label>
            <input
              id="access-code"
              className="form-control"
              type="password"
              autoComplete="off"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={200}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting || !code.trim()}
            style={{ width: "100%" }}
          >
            {isSubmitting ? "Checking..." : "Continue →"}
          </button>
        </form>
      </main>
    </>
  );
}
