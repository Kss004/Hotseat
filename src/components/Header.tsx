"use client";

import React from "react";

interface HeaderProps {
  onNewSession?: () => void;
}

export function Header({ onNewSession }: HeaderProps) {
  return (
    <header
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        background: "rgba(9, 12, 16, 0.8)",
        backdropFilter: "blur(12px)",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}
    >
      <div
        className="container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "1rem 1.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "var(--radius-md)",
              background: "linear-gradient(135deg, #e5a93c 0%, #d49326 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#090c10",
              fontWeight: 800,
              fontSize: "1.1rem",
              boxShadow: "0 2px 8px rgba(229, 169, 60, 0.4)",
            }}
          >
            ⚡
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: "1.05rem", letterSpacing: "-0.02em" }}>
              PREP<span style={{ color: "var(--accent-gold)" }}>COACH</span>
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              High-Stakes Role-Play Engine
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "var(--accent-emerald)",
                boxShadow: "0 0 8px rgba(16, 185, 129, 0.6)",
              }}
            />
            <span>Router Active</span>
          </div>

          {onNewSession && (
            <button className="btn btn-secondary" onClick={onNewSession} id="btn-header-new-session" style={{ fontSize: "0.8rem", padding: "0.45rem 0.9rem" }}>
              + New Session
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
