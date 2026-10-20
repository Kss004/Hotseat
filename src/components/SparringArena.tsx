import React, { useState, useRef, useEffect } from "react";
import type { Turn, PersonaRecord, Difficulty, Stance } from "@/types";
import {
  detectVoiceSupport,
  createSpeechRecognizer,
  speakPersonaReply,
  stopSpeaking,
  type SpeechRecognizerInstance,
} from "@/lib/audio/speech";
import { describeApiError, readJson } from "@/lib/apiErrors";

interface SparringArenaProps {
  sessionId: string;
  persona: PersonaRecord;
  difficulty: Difficulty;
  maxTurns: number;
  initialTurns?: Turn[];
  isEvaluating: boolean;
  onEndSimulation: () => void;
}

interface ChatEvent {
  event: "token" | "stance" | "done" | "error";
  token?: string;
  stance?: Stance | null;
  unavailable?: boolean;
  reasoning?: string;
  turn_number?: number;
  user_turn_number?: number;
  code?: string;
  error?: string;
}

/** Splits buffered SSE text into complete `data:` payloads, returning the unfinished remainder. */
function drainSseBuffer(buffer: string): { events: ChatEvent[]; rest: string } {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: ChatEvent[] = [];
  for (const block of blocks) {
    const line = block.trim();
    if (!line.startsWith("data: ")) continue;
    try {
      events.push(JSON.parse(line.slice(6)) as ChatEvent);
    } catch {
      console.warn("Dropped malformed SSE event:", line.slice(0, 120));
    }
  }
  return { events, rest };
}

export function SparringArena({
  sessionId,
  persona,
  difficulty,
  maxTurns,
  initialTurns = [],
  isEvaluating,
  onEndSimulation,
}: SparringArenaProps) {
  const lastKnownStance = [...initialTurns].reverse().find((t) => t.role === "assistant" && t.stance)?.stance ?? null;

  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [inputMessage, setInputMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStreamedReply, setCurrentStreamedReply] = useState("");
  const [currentStance, setCurrentStance] = useState<Stance | null>(lastKnownStance);
  const [stanceReasoning, setStanceReasoning] = useState<string>("");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);

  // Step 7 Voice AI states
  const [voiceSupport, setVoiceSupport] = useState({ hasSpeechRecognition: false, hasSpeechSynthesis: false });
  const [isListening, setIsListening] = useState(false);
  const [isVoiceOutputEnabled, setIsVoiceOutputEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognizerRef = useRef<SpeechRecognizerInstance | null>(null);
  const dictationBaseRef = useRef("");

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const userTurnCount = turns.filter((t) => t.role === "user").length;
  const isTurnCapReached = userTurnCount >= maxTurns;
  const isBusy = isStreaming || isEvaluating;

  // Keep the thread pinned to the latest message without scrolling the whole page
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, currentStreamedReply]);

  // Detect voice support on mount; stop audio, dictation and any in-flight stream on unmount
  useEffect(() => {
    setVoiceSupport(detectVoiceSupport());
    return () => {
      stopSpeaking();
      recognizerRef.current?.abort();
      abortRef.current?.abort();
    };
  }, []);

  const stopListening = () => {
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    setIsListening(false);
  };

  const toggleListening = () => {
    if (!voiceSupport.hasSpeechRecognition) {
      setErrorBanner("Speech recognition is not supported in this browser. Please use Chrome, Edge, or text input.");
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    stopSpeaking();
    setIsSpeaking(false);
    recognizerRef.current?.abort();

    // Dictation replaces only what was said in this listening session, so interim results never duplicate
    dictationBaseRef.current = inputMessage.trim();
    const recognizer = createSpeechRecognizer({
      onTranscript: (text) => {
        const base = dictationBaseRef.current;
        setInputMessage(base ? `${base} ${text}` : text);
      },
      onError: (err) => {
        if (err !== "no-speech" && err !== "aborted") {
          setErrorBanner(`Microphone error: ${err}. You can keep typing instead.`);
        }
        setIsListening(false);
      },
      onEnd: () => {
        recognizerRef.current = null;
        setIsListening(false);
      },
    });

    if (recognizer) {
      recognizerRef.current = recognizer;
      try {
        recognizer.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  };

  const toggleVoiceOutput = () => {
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
    }
    setIsVoiceOutputEnabled((prev) => !prev);
  };

  const sendMessage = async (messageText: string) => {
    if (!messageText || isBusy || isTurnCapReached) return;

    if (isListening) stopListening();
    setInputMessage("");
    setErrorBanner(null);
    setFailedMessage(null);
    setIsStreaming(true);
    setCurrentStreamedReply("");

    const optimisticId = `temp_user_${Date.now()}`;
    setTurns((prev) => [
      ...prev,
      {
        id: optimisticId,
        session_id: sessionId,
        turn_number: (prev.at(-1)?.turn_number ?? 0) + 1,
        role: "user",
        content: messageText,
        created_at: new Date().toISOString(),
      },
    ]);

    // The server rolls back an unanswered user turn, so the client does the same and offers a retry
    const failWith = (message: string, retryable: boolean) => {
      setTurns((prev) => prev.filter((t) => t.id !== optimisticId));
      setCurrentStreamedReply("");
      setErrorBanner(message);
      if (retryable) {
        setFailedMessage(messageText);
        setInputMessage(messageText);
      }
    };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageText }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const err = describeApiError(await readJson(res), "Failed to reach the counterpart.");
        failWith(err.message, err.retryable);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      let stance: Stance | null = null;
      let finished = false;

      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const drained = drainSseBuffer(buffer);
        buffer = drained.rest;

        for (const evt of drained.events) {
          if (evt.event === "token" && evt.token) {
            reply += evt.token;
            setCurrentStreamedReply(reply);
          } else if (evt.event === "stance") {
            stance = evt.stance ?? null;
            if (stance) {
              setCurrentStance(stance);
              setStanceReasoning(evt.reasoning || "");
            } else {
              setStanceReasoning("Stance reading unavailable for this turn");
            }
          } else if (evt.event === "done") {
            finished = true;
            const userTurnNumber = evt.user_turn_number;
            setTurns((prev) => [
              ...prev.map((t) =>
                t.id === optimisticId && userTurnNumber ? { ...t, id: `user_${userTurnNumber}`, turn_number: userTurnNumber } : t
              ),
              {
                id: `assistant_${evt.turn_number}`,
                session_id: sessionId,
                turn_number: evt.turn_number ?? 0,
                role: "assistant",
                content: reply,
                stance,
                created_at: new Date().toISOString(),
              },
            ]);
            setCurrentStreamedReply("");

            if (isVoiceOutputEnabled && voiceSupport.hasSpeechSynthesis && reply) {
              setIsSpeaking(true);
              speakPersonaReply(reply, () => setIsSpeaking(false));
            }
          } else if (evt.event === "error") {
            finished = true;
            const err = describeApiError({ code: evt.code, message: evt.error }, "The simulation hit an error.");
            failWith(err.message, err.retryable);
          }
        }
      }

      if (!finished) {
        failWith("The connection closed before the reply finished. Reload to see what was saved, or retry.", true);
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      failWith(err instanceof Error ? `Connection error: ${err.message}` : "Connection error", true);
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    sendMessage(inputMessage.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Helper for Stance visual styling
  const getStanceMeta = (stance: Stance) => {
    switch (stance) {
      case "skeptical":
        return { label: "Skeptical", color: "var(--accent-amber)", icon: "🤔", bg: "rgba(245, 158, 11, 0.15)" };
      case "guarded":
        return { label: "Guarded", color: "var(--accent-blue)", icon: "🛡️", bg: "rgba(59, 130, 246, 0.15)" };
      case "neutral":
        return { label: "Neutral", color: "var(--text-secondary)", icon: "⚖️", bg: "rgba(148, 163, 184, 0.15)" };
      case "intrigued":
        return { label: "Intrigued", color: "var(--accent-cyan)", icon: "💡", bg: "rgba(6, 182, 212, 0.15)" };
      case "convinced":
        return { label: "Convinced", color: "var(--accent-emerald)", icon: "🤝", bg: "rgba(16, 185, 129, 0.15)" };
      case "impatient":
        return { label: "Impatient", color: "var(--accent-rose)", icon: "⏱️", bg: "rgba(244, 63, 94, 0.15)" };
    }
  };

  const currentStanceMeta = currentStance
    ? getStanceMeta(currentStance)
    : { label: "No reading yet", color: "var(--text-secondary)", icon: "…", bg: "rgba(148, 163, 184, 0.1)" };

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
      {/* Top HUD: Persona status, Stance Meter, Turn Cap, End Session */}
      <div
        className="glass-card"
        style={{
          padding: "1rem 1.5rem",
          marginBottom: "1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              background: "var(--bg-elevated)",
              border: "2px solid var(--accent-gold)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.3rem",
            }}
          >
            👔
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>{persona.name}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              {persona.title} • {persona.company}
            </div>
          </div>
        </div>

        {/* Live Stance Meter */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.5rem 1rem",
            borderRadius: "var(--radius-full)",
            background: currentStanceMeta.bg,
            border: `1px solid ${currentStanceMeta.color}`,
          }}
          title={stanceReasoning || "Current persona stance"}
          aria-live="polite"
        >
          <span style={{ fontSize: "1.1rem" }}>{currentStanceMeta.icon}</span>
          <div>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
              Persona Stance
            </div>
            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: currentStanceMeta.color }}>
              {currentStanceMeta.label}
              {stanceReasoning && (
                <span style={{ fontWeight: 400, fontSize: "0.75rem", color: "var(--text-secondary)", marginLeft: "0.4rem" }}>
                  • {stanceReasoning.length > 60 ? `${stanceReasoning.slice(0, 60)}…` : stanceReasoning}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Voice AI Audio Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {voiceSupport.hasSpeechSynthesis && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={toggleVoiceOutput}
            id="btn-toggle-voice"
            title="Toggle persona audio speech playback"
            style={{ fontSize: "0.75rem", padding: "0.4rem 0.8rem" }}
          >
            {isVoiceOutputEnabled ? "🔊 Voice: ON" : "🔇 Voice: MUTED"}
          </button>
          )}

          {isSpeaking && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                stopSpeaking();
                setIsSpeaking(false);
              }}
              style={{ fontSize: "0.75rem", padding: "0.4rem 0.8rem", color: "var(--accent-amber)" }}
            >
              ⏹ Stop Audio
            </button>
          )}
        </div>

        {/* Turn Cap Meter */}
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
            Turns · {difficulty} mode
          </div>
          <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
            {userTurnCount} / {maxTurns} User Turns
          </div>
        </div>

        <button
          className="btn btn-danger"
          id="btn-end-simulation"
          onClick={onEndSimulation}
          disabled={isBusy || userTurnCount < 2}
          title={userTurnCount < 2 ? "Reply at least twice before ending" : undefined}
          style={{ padding: "0.6rem 1.25rem", fontSize: "0.85rem" }}
        >
          {isEvaluating ? "Evaluating…" : "End & Evaluate Session 🏁"}
        </button>
      </div>

      {errorBanner && (
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
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <span>⚠️ {errorBanner}</span>
          <span style={{ display: "flex", gap: "0.5rem" }}>
            {failedMessage && (
              <button
                type="button"
                className="btn btn-secondary"
                id="btn-retry-message"
                disabled={isBusy}
                onClick={() => sendMessage(failedMessage)}
                style={{ fontSize: "0.8rem", padding: "0.35rem 0.8rem" }}
              >
                ↻ Retry message
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              aria-label="Dismiss error"
              onClick={() => {
                setErrorBanner(null);
                setFailedMessage(null);
              }}
              style={{ fontSize: "0.8rem", padding: "0.35rem 0.6rem" }}
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {/* Main Conversation Thread */}
      <div
        className="glass-card sparring-thread"
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        <div ref={threadRef} aria-live="polite" style={{ flex: 1, overflowY: "auto", paddingRight: "0.5rem" }}>
          {turns.length === 0 && !currentStreamedReply && (
            <div
              style={{
                textAlign: "center",
                padding: "4rem 1rem",
                color: "var(--text-muted)",
              }}
            >
              <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>🎙️</div>
              <h3 style={{ fontSize: "1.2rem", color: "var(--text-primary)", marginBottom: "0.5rem" }}>
                Meeting with {persona.name} is in session
              </h3>
              <p style={{ maxWidth: "500px", margin: "0 auto", fontSize: "0.9rem" }}>
                Begin your pitch, present your executive summary, or ask an opening discovery question.
              </p>
            </div>
          )}

          {turns.map((turn) => {
            const isUser = turn.role === "user";
            const turnStanceMeta = turn.stance ? getStanceMeta(turn.stance as Stance) : null;

            return (
              <div
                key={turn.id}
                style={{
                  display: "flex",
                  justifyContent: isUser ? "flex-end" : "flex-start",
                  marginBottom: "1.25rem",
                }}
              >
                <div
                  style={{
                    maxWidth: "min(75%, 640px)",
                    padding: "1rem 1.25rem",
                    borderRadius: "var(--radius-lg)",
                    background: isUser ? "var(--bg-elevated)" : "rgba(18, 24, 38, 0.95)",
                    border: `1px solid ${isUser ? "var(--border-subtle)" : "rgba(229, 169, 60, 0.25)"}`,
                    boxShadow: "var(--shadow-sm)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "0.75rem",
                      marginBottom: "0.4rem",
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                    }}
                  >
                    <span style={{ fontWeight: 700, color: isUser ? "var(--accent-blue)" : "var(--accent-gold)" }}>
                      {isUser ? "YOU" : persona.name.toUpperCase()}
                    </span>

                    {!isUser && turnStanceMeta && (
                      <span
                        style={{
                          fontSize: "0.7rem",
                          padding: "0.15rem 0.5rem",
                          borderRadius: "var(--radius-full)",
                          background: turnStanceMeta.bg,
                          color: turnStanceMeta.color,
                          fontWeight: 600,
                        }}
                      >
                        {turnStanceMeta.icon} {turnStanceMeta.label}
                      </span>
                    )}
                  </div>

                  <p style={{ color: "var(--text-primary)", fontSize: "0.95rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                    {turn.content}
                  </p>
                </div>
              </div>
            );
          })}

          {/* Streaming reply bubble */}
          {currentStreamedReply && (
            <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "1.25rem" }}>
              <div
                style={{
                  maxWidth: "min(75%, 640px)",
                  padding: "1rem 1.25rem",
                  borderRadius: "var(--radius-lg)",
                  background: "rgba(18, 24, 38, 0.95)",
                  border: "1px solid rgba(229, 169, 60, 0.35)",
                  boxShadow: "var(--shadow-glow)",
                }}
              >
                <div style={{ marginBottom: "0.4rem", fontSize: "0.75rem", fontWeight: 700, color: "var(--accent-gold)" }}>
                  {persona.name.toUpperCase()} (Replying...)
                </div>
                <p style={{ color: "var(--text-primary)", fontSize: "0.95rem", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                  {currentStreamedReply}
                  <span
                    style={{
                      display: "inline-block",
                      width: "6px",
                      height: "14px",
                      marginLeft: "4px",
                      background: "var(--accent-gold)",
                      verticalAlign: "middle",
                      animation: "blink 1s infinite",
                    }}
                  />
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Input Bar */}
        <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "1rem" }}>
          {isTurnCapReached ? (
            <div
              style={{
                textAlign: "center",
                padding: "1rem",
                background: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: "var(--radius-md)",
                color: "#fde68a",
              }}
            >
              <strong>Turn limit reached ({maxTurns} messages).</strong> The simulation has concluded. Click below to generate your performance report.
              <div style={{ marginTop: "0.75rem" }}>
                <button className="btn btn-primary" onClick={onEndSimulation} id="btn-turn-cap-evaluate" disabled={isBusy}>
                  {isEvaluating ? "Evaluating…" : "Generate Evaluation Report →"}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSendMessage} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                rows={2}
                className="form-control"
                id="sparring-chat-input"
                placeholder={
                  isListening
                    ? "🎙️ Listening... Speak your pitch clearly into your microphone..."
                    : isStreaming
                    ? `${persona.name} is speaking...`
                    : "Type your response or pitch... (Press Enter to send, Shift+Enter for newline)"
                }
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isBusy}
                aria-label="Your message"
                style={{
                  flex: 1,
                  minWidth: 0,
                  resize: "none",
                  borderColor: isListening ? "var(--accent-rose)" : undefined,
                  boxShadow: isListening ? "0 0 12px rgba(244, 63, 94, 0.4)" : undefined,
                }}
              />

              {/* Microphone STT Button */}
              {voiceSupport.hasSpeechRecognition && (
                <button
                  type="button"
                  className={`btn ${isListening ? "btn-danger" : "btn-secondary"}`}
                  id="btn-voice-mic"
                  onClick={toggleListening}
                  disabled={isBusy}
                  aria-label={isListening ? "Stop dictation" : "Dictate with microphone"}
                  title={isListening ? "Click to stop listening" : "Click to speak via microphone"}
                  style={{ padding: "0.85rem 1rem", fontSize: "1.1rem" }}
                >
                  {isListening ? "🔴 Stop" : "🎙️"}
                </button>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                id="btn-send-message"
                disabled={isBusy || !inputMessage.trim()}
                style={{ padding: "0.85rem 1.5rem" }}
              >
                {isStreaming ? "Thinking..." : "Send →"}
              </button>
            </form>
          )}
          {!isTurnCapReached && userTurnCount < 2 && (
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
              Reply at least {2 - userTurnCount} more time{2 - userTurnCount === 1 ? "" : "s"} to unlock End &amp; Evaluate.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
