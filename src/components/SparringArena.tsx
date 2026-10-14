import React, { useState, useRef, useEffect } from "react";
import type { Turn, PersonaRecord, Difficulty, Stance } from "@/types";
import {
  detectVoiceSupport,
  createSpeechRecognizer,
  speakPersonaReply,
  stopSpeaking,
} from "@/lib/audio/speech";

interface SparringArenaProps {
  sessionId: string;
  persona: PersonaRecord;
  difficulty: Difficulty;
  maxTurns: number;
  initialTurns?: Turn[];
  onEndSimulation: () => void;
}

export function SparringArena({
  sessionId,
  persona,
  difficulty,
  maxTurns,
  initialTurns = [],
  onEndSimulation,
}: SparringArenaProps) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [inputMessage, setInputMessage] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentStreamedReply, setCurrentStreamedReply] = useState("");
  const [currentStance, setCurrentStance] = useState<Stance>("guarded");
  const [stanceReasoning, setStanceReasoning] = useState<string>("");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Step 7 Voice AI states
  const [voiceSupport, setVoiceSupport] = useState({ hasSpeechRecognition: false, hasSpeechSynthesis: false });
  const [isListening, setIsListening] = useState(false);
  const [isVoiceOutputEnabled, setIsVoiceOutputEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognizerRef = useRef<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const userTurnCount = turns.filter((t) => t.role === "user").length;
  const isTurnCapReached = userTurnCount >= maxTurns;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [turns, currentStreamedReply]);

  // Detect voice support on mount
  useEffect(() => {
    const support = detectVoiceSupport();
    setVoiceSupport(support);
    return () => {
      stopSpeaking();
      if (recognizerRef.current) {
        recognizerRef.current.abort();
      }
    };
  }, []);

  const toggleListening = () => {
    if (!voiceSupport.hasSpeechRecognition) {
      setErrorBanner("Speech recognition is not supported in this browser. Please use Chrome, Edge, or text input.");
      return;
    }

    if (isListening) {
      recognizerRef.current?.stop();
      setIsListening(false);
    } else {
      stopSpeaking();
      setIsSpeaking(false);

      const recognizer = createSpeechRecognizer({
        onTranscript: (text, isFinal) => {
          setInputMessage((prev) => (prev ? `${prev.trim()} ${text}` : text));
          if (isFinal) {
            setIsListening(false);
          }
        },
        onError: (err) => {
          console.warn("Speech recognition error:", err);
          setIsListening(false);
        },
        onEnd: () => {
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
    }
  };

  const toggleVoiceOutput = () => {
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
    }
    setIsVoiceOutputEnabled((prev) => !prev);
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || isStreaming || isTurnCapReached) return;

    const messageText = inputMessage.trim();
    setInputMessage("");
    setErrorBanner(null);
    setIsStreaming(true);
    setCurrentStreamedReply("");

    // Optimistically add user turn
    const userTurnNumber = turns.length + 1;
    const optimisticUserTurn: Turn = {
      id: `temp_user_${Date.now()}`,
      session_id: sessionId,
      turn_number: userTurnNumber,
      role: "user",
      content: messageText,
      created_at: new Date().toISOString(),
    };

    setTurns((prev) => [...prev, optimisticUserTurn]);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageText }),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        if (errorJson.code === "TURN_CAP") {
          setErrorBanner("Maximum turn cap reached. Please end simulation to generate your evaluation report.");
        } else {
          setErrorBanner(errorJson.message || "Failed to communicate with counterpart");
        }
        setIsStreaming(false);
        return;
      }

      if (!res.body) {
        throw new Error("No response body received");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedReply = "";
      let finalStance: Stance = "skeptical";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const parsed = JSON.parse(trimmed.slice(6));

            if (parsed.event === "token" && parsed.token) {
              accumulatedReply += parsed.token;
              setCurrentStreamedReply(accumulatedReply);
            } else if (parsed.event === "stance" && parsed.stance) {
              finalStance = parsed.stance;
              setCurrentStance(parsed.stance);
              if (parsed.reasoning) {
                setStanceReasoning(parsed.reasoning);
              }
            } else if (parsed.event === "done") {
              const assistantTurn: Turn = {
                id: `turn_a_${Date.now()}`,
                session_id: sessionId,
                turn_number: userTurnNumber + 1,
                role: "assistant",
                content: accumulatedReply,
                stance: finalStance,
                created_at: new Date().toISOString(),
              };
              setTurns((prev) => [...prev, assistantTurn]);
              setCurrentStreamedReply("");

              // Play voice audio if enabled
              if (isVoiceOutputEnabled && accumulatedReply) {
                setIsSpeaking(true);
                speakPersonaReply(accumulatedReply, () => setIsSpeaking(false));
              }
            } else if (parsed.event === "error") {
              setErrorBanner(parsed.error || "Simulation error");
            }
          } catch {
            // ignore non-json SSE line
          }
        }
      }
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : "Error streaming response");
    } finally {
      setIsStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
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

  const currentStanceMeta = getStanceMeta(currentStance);

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
        >
          <span style={{ fontSize: "1.1rem" }}>{currentStanceMeta.icon}</span>
          <div>
            <div style={{ fontSize: "0.7rem", textTransform: "uppercase", color: "var(--text-muted)", letterSpacing: "0.05em" }}>
              Persona Stance
            </div>
            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: currentStanceMeta.color }}>
              {currentStanceMeta.label}
            </div>
          </div>
        </div>

        {/* Voice AI Audio Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
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
            Turn Limit ({difficulty})
          </div>
          <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>
            {userTurnCount} / {maxTurns} User Turns
          </div>
        </div>

        <button
          className="btn btn-danger"
          id="btn-end-simulation"
          onClick={onEndSimulation}
          style={{ padding: "0.6rem 1.25rem", fontSize: "0.85rem" }}
        >
          End & Evaluate Session 🏁
        </button>
      </div>

      {errorBanner && (
        <div
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
          ⚠️ {errorBanner}
        </div>
      )}

      {/* Main Conversation Thread */}
      <div
        className="glass-card"
        style={{
          height: "550px",
          display: "flex",
          flexDirection: "column",
          padding: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        <div style={{ flex: 1, overflowY: "auto", paddingRight: "0.5rem" }}>
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
                    maxWidth: "75%",
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
                  maxWidth: "75%",
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

          <div ref={messagesEndRef} />
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
                <button className="btn btn-primary" onClick={onEndSimulation} id="btn-turn-cap-evaluate">
                  Generate Evaluation Report →
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
                disabled={isStreaming}
                style={{
                  flex: 1,
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
                  disabled={isStreaming}
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
                disabled={isStreaming || !inputMessage.trim()}
                style={{ padding: "0.85rem 1.5rem" }}
              >
                {isStreaming ? "Thinking..." : "Send →"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
