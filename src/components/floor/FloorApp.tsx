"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/apiErrors";

// ==========================================
// Types mirrored from /api/floor/state
// ==========================================

interface Rep {
  id: string;
  name: string;
  phone_e164: string;
  deal_notes: string;
  consent_at: string;
  consent_note: string;
  opted_out_at: string | null;
}

interface CallRow {
  call_id: string;
  rep_name: string;
  call_status: string;
  duration_sec: number | null;
  eval_status: string;
  eval_error: string | null;
  prep_status: string;
  prep_error: string | null;
  overall_score: number | null;
  weakest_category: string | null;
  verified_quotes: number | null;
  report_token: string;
}

interface Run {
  id: string;
  scheduled_at: string;
  status: string;
  error: string | null;
  auto_launch: boolean;
  bolna_batch_id: string | null;
  counts: { planned: number; prepared: number; connected: number; scored: number; not_scored: number; failed: number };
  calls: CallRow[];
}

interface CategoryStat {
  category: string;
  n: number;
  mean: number | null;
  unanswered: number;
  worst: { score: number; rep_name: string; objection: string; quote: string | null; report_token: string } | null;
}

interface Dashboard {
  categories: CategoryStat[];
  weakest: string | null;
  scope_run_ids: string[];
  scored_calls: number;
}

interface FloorState {
  settings: { product_summary: string; goal: string; daily_enabled: boolean; bolna_agent_id: string };
  config: { missing: string[]; call_hour_ist: number; max_call_seconds: number; next_morning: string };
  reps: Rep[];
  runs: Run[];
  dashboard: { latest: Dashboard; week: Dashboard };
}

type Tab = "dashboard" | "runs" | "roster" | "setup";

const ACTIVE_RUN = new Set(["preparing", "launching", "scheduled", "calling", "scoring"]);
const MIN_N = 3;

// ==========================================
// Small helpers
// ==========================================

async function api<T = Record<string, unknown>>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await readJson<T & { code?: string; message?: string }>(res);
  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`) as Error & { code?: string };
    err.code = data?.code;
    throw err;
  }
  return data as T;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }) + " IST";
}

function scoreColor(score: number) {
  if (score >= 8) return "var(--accent-emerald)";
  if (score >= 6) return "var(--accent-gold)";
  return "var(--accent-rose)";
}

const CALL_LABEL: Record<string, string> = {
  not_started: "Not sent",
  scheduled: "Scheduled",
  queued: "Queued",
  initiated: "Dialling",
  ringing: "Ringing",
  "in-progress": "On the call",
  "call-disconnected": "Hung up",
  completed: "Completed",
  "no-answer": "No answer",
  busy: "Busy",
  failed: "Failed",
  canceled: "Cancelled",
  stopped: "Stopped",
  error: "Error",
  "balance-low": "Balance low",
  rescheduled: "Rescheduled",
};

const EVAL_LABEL: Record<string, string> = {
  waiting: "Waiting for call",
  pending: "Queued for scoring",
  scoring: "Scoring…",
  scored: "Scored",
  not_scored: "Not scored",
  failed: "Scoring failed",
};

function reportUrl(token: string) {
  return `${window.location.origin}/floor/report/${encodeURIComponent(token)}`;
}

// ==========================================
// App
// ==========================================

export function FloorApp() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [state, setState] = useState<FloorState | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const tickRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await api<FloorState>("/api/floor/state");
      setState(data);
      setAuthed(true);
    } catch (err) {
      if ((err as { code?: string }).code === "UNAUTHORIZED") setAuthed(false);
      else setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hasActiveWork = !!state?.runs.some((r) => ACTIVE_RUN.has(r.status) || r.calls.some((c) => ["pending", "scoring"].includes(c.eval_status)));

  // While anything is in flight: refresh every 5s, and keep one background tick (prep, scoring, Bolna catch-up) going
  useEffect(() => {
    if (!authed || !hasActiveWork) return;
    const refresh = setInterval(load, 5000);
    const runTick = async () => {
      if (tickRunning.current) return;
      tickRunning.current = true;
      try {
        await api("/api/floor/tick", "POST");
      } catch (err) {
        setError(`Background work: ${(err as Error).message}`);
      } finally {
        tickRunning.current = false;
        load();
      }
    };
    runTick();
    const ticker = setInterval(runTick, 15000);
    return () => {
      clearInterval(refresh);
      clearInterval(ticker);
    };
  }, [authed, hasActiveWork, load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
      // Reload either way: a failed action can still have changed state on the server
      await load();
    }
  };

  if (authed === null) {
    return <main className="container" style={{ padding: "3rem 1rem" }}><p className="floor-muted">Loading…</p></main>;
  }
  if (!authed) return <Login onDone={load} />;
  if (!state) return null;

  return (
    <main className="container" style={{ padding: "1.5rem 1rem 4rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 800 }}>Hotseat Floor</h1>
          <p className="floor-muted">Every morning, each rep takes a practice call from a skeptical buyer in their own deal.</p>
        </div>
        <button className="btn btn-secondary" onClick={() => act("logout", () => api("/api/floor/logout", "POST")).then(() => setAuthed(false))}>
          Log out
        </button>
      </div>

      {state.config.missing.length > 0 && (
        <div className="floor-error">
          Calling is off until these settings are added to the server environment: {state.config.missing.join(", ")}.
        </div>
      )}
      {error && (
        <div className="floor-error" role="alert">
          {error}{" "}
          <button className="btn btn-secondary" style={{ padding: "0.2rem 0.6rem", marginLeft: "0.5rem" }} onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="floor-tabs" role="tablist">
        {(["dashboard", "runs", "roster", "setup"] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className="floor-tab" onClick={() => setTab(t)}>
            {t === "dashboard" ? "Floor dashboard" : t === "runs" ? "Calls" : t === "roster" ? `Reps (${state.reps.filter((r) => !r.opted_out_at).length})` : "Setup"}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab state={state} />}
      {tab === "runs" && <RunsTab state={state} busy={busy} act={act} />}
      {tab === "roster" && <RosterTab state={state} busy={busy} act={act} />}
      {tab === "setup" && <SetupTab state={state} busy={busy} act={act} />}
    </main>
  );
}

type Act = (label: string, fn: () => Promise<unknown>) => Promise<void>;

// ==========================================
// Login
// ==========================================

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/floor/login", "POST", { password });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="container" style={{ padding: "4rem 1rem", maxWidth: 420 }}>
      <form className="glass-card floor-section" onSubmit={submit}>
        <h1 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.5rem" }}>Hotseat Floor</h1>
        <p className="floor-muted" style={{ marginBottom: "1rem" }}>Manager login</p>
        {error && <div className="floor-error">{error}</div>}
        <div className="form-group">
          <label className="form-label" htmlFor="floor-password">Password</label>
          <input id="floor-password" className="form-control" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy || !password} style={{ width: "100%" }}>
          {busy ? "Checking…" : "Log in"}
        </button>
      </form>
    </main>
  );
}

// ==========================================
// Dashboard
// ==========================================

function DashboardTab({ state }: { state: FloorState }) {
  const [scope, setScope] = useState<"latest" | "week">("latest");
  const dash = state.dashboard[scope];
  const latestRun = state.runs.find((r) => r.id === state.dashboard.latest.scope_run_ids[0]);

  if (state.dashboard.week.scored_calls === 0) {
    return (
      <div className="glass-card floor-section">
        <h2>No scored calls yet</h2>
        <p className="floor-muted">
          Add reps under Reps, describe what the team sells under Setup, then start a run under Calls. Scores appear here as soon as the first calls are scored.
        </p>
      </div>
    );
  }

  return (
    <>
      {latestRun && (
        <div className="glass-card floor-section">
          <h2>Latest morning · {fmtTime(latestRun.scheduled_at)}</h2>
          <div className="floor-stat-line" style={{ marginTop: "0.5rem" }}>
            <span><strong>{latestRun.counts.planned}</strong> planned</span>
            <span><strong>{latestRun.counts.connected}</strong> connected</span>
            <span><strong>{latestRun.counts.scored}</strong> scored</span>
            <span><strong>{latestRun.counts.not_scored}</strong> not scored</span>
            <span><strong>{latestRun.counts.failed}</strong> scoring failed</span>
          </div>
          <p className="floor-muted" style={{ marginTop: "0.5rem" }}>
            Every score comes from a recorded call, and every quote shown was found word for word in what the rep said. Calls that didn&apos;t connect or were too short are listed as not scored, never estimated.
          </p>
        </div>
      )}

      <div className="glass-card floor-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <h2>Objection handling by category</h2>
            <p className="floor-muted">Mean handling score (1–10) for each objection category the buyer raised, across {dash.scored_calls} scored call{dash.scored_calls === 1 ? "" : "s"}.</p>
          </div>
          <div className="floor-actions">
            <button className={`btn ${scope === "latest" ? "btn-primary" : "btn-secondary"}`} onClick={() => setScope("latest")}>Latest morning</button>
            <button className={`btn ${scope === "week" ? "btn-primary" : "btn-secondary"}`} onClick={() => setScope("week")}>Last 7 runs</button>
          </div>
        </div>

        {dash.weakest ? (
          <p style={{ marginTop: "1rem", fontWeight: 700 }}>
            Weakest category: <span style={{ color: "var(--accent-rose)" }}>{dash.weakest}</span>
          </p>
        ) : (
          <p className="floor-muted" style={{ marginTop: "1rem" }}>
            No category has {MIN_N}+ scored objections yet, so none is ranked as the weakest.
          </p>
        )}

        <div style={{ marginTop: "0.5rem" }}>
          {dash.categories.map((c) => (
            <div key={c.category} className="floor-cat">
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <strong>{c.category}{dash.weakest === c.category ? " · weakest" : ""}</strong>
                <span className="floor-muted">
                  {c.mean === null ? "no data" : `${c.mean}/10`} · n={c.n}
                  {c.unanswered > 0 ? ` · ${c.unanswered} never answered` : ""}
                  {c.n > 0 && c.n < MIN_N ? " · not enough data to rank" : ""}
                </span>
              </div>
              <div className="floor-bar">
                {c.mean !== null && <span style={{ width: `${c.mean * 10}%`, background: scoreColor(c.mean) }} />}
              </div>
              {c.worst && (
                <div className="floor-muted">
                  Lowest: {c.worst.rep_name} ({c.worst.score}/10) on &ldquo;{c.worst.objection}&rdquo;{" "}
                  <a href={`/floor/report/${encodeURIComponent(c.worst.report_token)}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent-gold)" }}>
                    open report
                  </a>
                  {c.worst.quote ? <div className="floor-quote">&ldquo;{c.worst.quote}&rdquo;</div> : <div className="floor-quote">The rep never answered this objection.</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {latestRun && (
        <div className="glass-card floor-section">
          <h2>Reps · latest morning</h2>
          <CallTable run={latestRun} />
        </div>
      )}
    </>
  );
}

function CallTable({ run, onRescore }: { run: Run; onRescore?: (callId: string) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(reportUrl(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      window.prompt("Copy this report link:", reportUrl(token));
    }
  };
  return (
    <div className="floor-table-wrap">
      <table className="floor-table">
        <thead>
          <tr>
            <th>Rep</th>
            <th>Call</th>
            <th>Score</th>
            <th>Weakest</th>
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          {run.calls.map((c) => (
            <tr key={c.call_id}>
              <td>{c.rep_name}</td>
              <td>
                {c.prep_status === "pending" ? "Preparing…" : c.prep_status === "failed" ? "Not prepared" : CALL_LABEL[c.call_status] || c.call_status}
                {c.duration_sec ? <span className="floor-muted"> · {Math.round(c.duration_sec)}s</span> : null}
              </td>
              <td>
                {c.overall_score !== null ? (
                  <span style={{ color: scoreColor(c.overall_score), fontWeight: 700 }}>{c.overall_score}</span>
                ) : (
                  <span className="floor-muted" title={c.eval_error || undefined}>
                    {EVAL_LABEL[c.eval_status] || c.eval_status}
                    {c.eval_error ? `: ${c.eval_error}` : ""}
                    {c.prep_error && c.eval_status !== "not_scored" ? `: ${c.prep_error}` : ""}
                  </span>
                )}
                {c.eval_status === "scored" && c.verified_quotes !== null && (
                  <div className="floor-muted" style={{ fontSize: "0.75rem" }}>{c.verified_quotes} verified quotes</div>
                )}
                {onRescore && c.eval_status === "failed" && c.call_status === "completed" && (
                  <div><button className="btn btn-secondary" style={{ padding: "0.2rem 0.6rem", marginTop: "0.3rem" }} onClick={() => onRescore(c.call_id)}>Retry scoring</button></div>
                )}
              </td>
              <td>{c.weakest_category || <span className="floor-muted">–</span>}</td>
              <td>
                {c.call_status === "completed" || c.eval_status === "scored" ? (
                  <div className="floor-actions">
                    <a href={`/floor/report/${encodeURIComponent(c.report_token)}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent-gold)" }}>Open</a>
                    <button className="floor-tab" style={{ padding: 0, borderBottom: "none" }} onClick={() => copy(c.report_token)}>
                      {copied === c.report_token ? "Copied" : "Copy link"}
                    </button>
                  </div>
                ) : (
                  <span className="floor-muted">–</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ==========================================
// Runs
// ==========================================

const RUN_LABEL: Record<string, string> = {
  preparing: "Preparing calls",
  ready: "Ready to launch",
  launching: "Sending to Bolna",
  scheduled: "Scheduled",
  calling: "Calling",
  scoring: "Scoring",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

function RunsTab({ state, busy, act }: { state: FloorState; busy: string | null; act: Act }) {
  const activeReps = state.reps.filter((r) => !r.opted_out_at).length;
  const blocked = state.config.missing.length > 0 || !state.settings.product_summary || activeReps === 0;
  return (
    <>
      <div className="glass-card floor-section">
        <h2>Start a run</h2>
        <p className="floor-muted" style={{ marginBottom: "1rem" }}>
          Each run prepares a fresh buyer for every rep (about a minute per rep, a few at a time), then Bolna calls them all in one batch. Calls only go out between 09:00 and 21:00 IST.
        </p>
        {blocked && (
          <p className="floor-muted" style={{ marginBottom: "1rem", color: "var(--accent-amber)" }}>
            {activeReps === 0 ? "Add at least one rep first. " : ""}
            {!state.settings.product_summary ? "Describe what the team sells under Setup. " : ""}
            {state.config.missing.length > 0 ? "Finish the Bolna settings on the server. " : ""}
          </p>
        )}
        <div className="floor-actions">
          <button className="btn btn-primary" disabled={blocked || !!busy} onClick={() => act("run-now", () => api("/api/floor/runs", "POST", { when: "now" }))}>
            Prepare calls now ({activeReps} rep{activeReps === 1 ? "" : "s"})
          </button>
          <button className="btn btn-secondary" disabled={blocked || !!busy} onClick={() => act("run-morning", () => api("/api/floor/runs", "POST", { when: "next_morning" }))}>
            Prepare and auto-launch for {fmtTime(state.config.next_morning)}
          </button>
        </div>
      </div>

      {state.runs.length === 0 && <p className="floor-muted">No runs yet.</p>}
      {state.runs.map((run) => (
        <div key={run.id} className="glass-card floor-section">
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <h2>{fmtTime(run.scheduled_at)}</h2>
              <p className="floor-muted">
                <span className="badge badge-gold" style={{ marginRight: "0.5rem" }}>{RUN_LABEL[run.status] || run.status}</span>
                {run.counts.prepared}/{run.counts.planned} prepared · {run.counts.connected} connected · {run.counts.scored} scored
                {run.auto_launch ? " · launches automatically" : ""}
              </p>
            </div>
            <div className="floor-actions">
              {(run.status === "ready" || (run.status === "failed" && !run.bolna_batch_id && run.counts.prepared > 0)) && (
                <button className="btn btn-primary" disabled={!!busy || state.config.missing.length > 0} onClick={() => act("launch", () => api(`/api/floor/runs/${run.id}/launch`, "POST"))}>
                  {busy === "launch" ? "Sending…" : run.status === "failed" ? "Retry launch" : "Launch calls"}
                </button>
              )}
              {["preparing", "ready", "scheduled", "calling"].includes(run.status) && (
                <button
                  className="btn btn-danger"
                  disabled={!!busy}
                  onClick={() => window.confirm("Cancel this run? Calls not yet placed won't be made.") && act("cancel", () => api(`/api/floor/runs/${run.id}/cancel`, "POST"))}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          {run.error && <div className="floor-error" style={{ marginTop: "0.75rem" }}>{run.error}</div>}
          <div style={{ marginTop: "0.75rem" }}>
            <CallTable run={run} onRescore={(id) => act("rescore", () => api(`/api/floor/calls/${id}/rescore`, "POST"))} />
          </div>
        </div>
      ))}
    </>
  );
}

// ==========================================
// Roster
// ==========================================

const CONSENT_TEXT =
  "I agree to receive AI practice calls from Hotseat on this number between 09:00 and 21:00 IST. Calls are recorded, transcribed and scored for coaching, and my manager can see the results. Recordings are deleted when the program ends. I can opt out at any time.";

function RosterTab({ state, busy, act }: { state: FloorState; busy: string | null; act: Act }) {
  const [form, setForm] = useState({ name: "", phone_e164: "", deal_notes: "", consent: false, consent_note: "" });
  const [bulk, setBulk] = useState("");
  const [bulkConsent, setBulkConsent] = useState(false);
  const [bulkNote, setBulkNote] = useState("");
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const addOne = () =>
    act("add-rep", async () => {
      await api("/api/floor/reps", "POST", form);
      setForm({ name: "", phone_e164: "", deal_notes: "", consent: false, consent_note: "" });
    });

  // One rep per line: name, phone, deal notes (deal notes may contain commas)
  const addBulk = () =>
    act("bulk", async () => {
      const lines = bulk.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const failures: string[] = [];
      let added = 0;
      for (const line of lines) {
        const [name, phone, ...rest] = line.split(",");
        try {
          await api("/api/floor/reps", "POST", {
            name: (name || "").trim(),
            phone_e164: (phone || "").trim(),
            deal_notes: rest.join(",").trim(),
            consent: bulkConsent,
            consent_note: bulkNote,
          });
          added++;
        } catch (err) {
          failures.push(`${(name || "?").trim()}: ${(err as Error).message}`);
        }
      }
      setBulkResult(`Added ${added} of ${lines.length}.${failures.length ? " Problems: " + failures.join(" | ") : ""}`);
      if (failures.length === 0) setBulk("");
    });

  return (
    <>
      <div className="glass-card floor-section">
        <h2>Consent first</h2>
        <p className="floor-muted">Only add reps who have agreed to this, in writing:</p>
        <div className="floor-quote" style={{ borderLeftColor: "var(--accent-gold)" }}>{CONSENT_TEXT}</div>
      </div>

      <div className="grid-split">
        <div className="glass-card floor-section">
          <h2>Add a rep</h2>
          <div className="form-group">
            <label className="form-label" htmlFor="rep-name">First name</label>
            <input id="rep-name" className="form-control" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rep-phone">Mobile (international format)</label>
            <input id="rep-phone" className="form-control" placeholder="+919876543210" value={form.phone_e164} onChange={(e) => setForm({ ...form, phone_e164: e.target.value })} />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="rep-deal">Their deal: who the buyer is, their company, where it stands (80+ characters)</label>
            <textarea id="rep-deal" className="form-control" rows={4} value={form.deal_notes} onChange={(e) => setForm({ ...form, deal_notes: e.target.value })} />
          </div>
          <label className="floor-muted" style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
            This rep agreed to the text above
          </label>
          <div className="form-group">
            <label className="form-label" htmlFor="rep-consent-note">How they agreed</label>
            <input id="rep-consent-note" className="form-control" placeholder="e.g. signed Google Form, 28 Oct" value={form.consent_note} onChange={(e) => setForm({ ...form, consent_note: e.target.value })} />
          </div>
          <button className="btn btn-primary" disabled={!!busy || !form.consent} onClick={addOne}>Add rep</button>
        </div>

        <div className="glass-card floor-section">
          <h2>Add many at once</h2>
          <p className="floor-muted" style={{ marginBottom: "0.75rem" }}>One rep per line: <code>name, +91phone, deal notes</code></p>
          <textarea className="form-control" rows={7} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder="Asha, +919876543210, Selling our analytics suite to Priya Rao, CFO at Northwind Retail. Second meeting; she thinks it is too expensive..." />
          <label className="floor-muted" style={{ display: "flex", gap: "0.5rem", margin: "0.75rem 0" }}>
            <input type="checkbox" checked={bulkConsent} onChange={(e) => setBulkConsent(e.target.checked)} />
            Every rep listed agreed to the text above
          </label>
          <input className="form-control" placeholder="How they agreed" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} style={{ marginBottom: "0.75rem" }} />
          <button className="btn btn-primary" disabled={!!busy || !bulkConsent || !bulk.trim()} onClick={addBulk}>Add all</button>
          {bulkResult && <p className="floor-muted" style={{ marginTop: "0.75rem" }}>{bulkResult}</p>}
        </div>
      </div>

      <div className="glass-card floor-section">
        <h2>Reps ({state.reps.length})</h2>
        <div className="floor-table-wrap">
          <table className="floor-table">
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Deal</th><th>Consent</th><th></th></tr>
            </thead>
            <tbody>
              {state.reps.map((r) => (
                <tr key={r.id} style={{ opacity: r.opted_out_at ? 0.55 : 1 }}>
                  <td>{r.name}</td>
                  <td>{r.phone_e164}</td>
                  <td style={{ maxWidth: 360 }}>{r.deal_notes.length > 140 ? r.deal_notes.slice(0, 140) + "…" : r.deal_notes}</td>
                  <td>{r.opted_out_at ? "Opted out" : `${r.consent_note} (${new Date(r.consent_at).toLocaleDateString("en-IN")})`}</td>
                  <td>
                    <div className="floor-actions">
                      {r.opted_out_at ? (
                        <button className="btn btn-secondary" disabled={!!busy} onClick={() => {
                          const note = window.prompt("How did they agree again?");
                          if (note) act("optin", () => api(`/api/floor/reps/${r.id}`, "PATCH", { opted_out: false, consent_note: note }));
                        }}>Opt back in</button>
                      ) : (
                        <button className="btn btn-secondary" disabled={!!busy} onClick={() => act("optout", () => api(`/api/floor/reps/${r.id}`, "PATCH", { opted_out: true }))}>Opt out</button>
                      )}
                      <button className="btn btn-danger" disabled={!!busy} onClick={() => window.confirm(`Delete ${r.name} and all their calls, transcripts and scores?`) && act("delete", () => api(`/api/floor/reps/${r.id}`, "DELETE"))}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ==========================================
// Setup
// ==========================================

function SetupTab({ state, busy, act }: { state: FloorState; busy: string | null; act: Act }) {
  const [form, setForm] = useState({
    product_summary: state.settings.product_summary,
    goal: state.settings.goal,
    daily_enabled: state.settings.daily_enabled,
  });
  return (
    <>
      <div className="glass-card floor-section">
        <h2>What the team sells</h2>
        <div className="form-group">
          <label className="form-label" htmlFor="floor-product">Product and value, in a few sentences</label>
          <textarea id="floor-product" className="form-control" rows={4} value={form.product_summary} onChange={(e) => setForm({ ...form, product_summary: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="floor-goal">What a rep should get out of the call</label>
          <input id="floor-goal" className="form-control" placeholder="e.g. Book a pilot kickoff with the economic buyer" value={form.goal} onChange={(e) => setForm({ ...form, goal: e.target.value })} />
        </div>
        <label className="floor-muted" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <input type="checkbox" checked={form.daily_enabled} onChange={(e) => setForm({ ...form, daily_enabled: e.target.checked })} />
          Call the floor every morning at {String(state.config.call_hour_ist).padStart(2, "0")}:00 IST (the next run is prepared automatically)
        </label>
        <button className="btn btn-primary" disabled={!!busy} onClick={() => act("settings", () => api("/api/floor/settings", "PUT", form))}>
          {busy === "settings" ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="glass-card floor-section">
        <h2>Bolna voice agent</h2>
        <p className="floor-muted" style={{ marginBottom: "0.75rem" }}>
          One agent plays every buyer; each call gets its own persona and objection plan. Calls last up to {Math.round(state.config.max_call_seconds / 60)} minutes.
          The agent is created on the first launch and updated automatically when its prompt or voice settings change.
        </p>
        <p className="floor-muted" style={{ marginBottom: "0.75rem" }}>
          Status: {state.config.missing.length > 0 ? `missing ${state.config.missing.join(", ")}` : state.settings.bolna_agent_id ? "agent ready" : "configured, agent not created yet"}
        </p>
        <button className="btn btn-secondary" disabled={!!busy || state.config.missing.length > 0} onClick={() => act("agent", () => api("/api/floor/agent", "POST"))}>
          {busy === "agent" ? "Syncing…" : state.settings.bolna_agent_id ? "Push settings to agent" : "Create agent now"}
        </button>
      </div>
    </>
  );
}
