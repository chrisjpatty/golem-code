import { useState, useCallback, useRef } from "react";
import type { ConnectionState } from "./useGolemSocket";

type VoiceButtonProps = {
  onTranscript: (text: string) => void;
  connectionState?: ConnectionState;
};

export function VoiceButton({ onTranscript, connectionState = "connected" }: VoiceButtonProps) {
  const [pressed, setPressed] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef("");

  const handleDown = useCallback(() => {
    setPressed(true);
    setTranscript("");
    transcriptRef.current = "";

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      console.warn("[golem] SpeechRecognition not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) {
          finalTranscript += result[0]!.transcript;
        } else {
          interimTranscript += result[0]!.transcript;
        }
      }
      const text = finalTranscript || interimTranscript;
      transcriptRef.current = text;
      setTranscript(text);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.warn("[golem] Speech recognition error:", event.error);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, []);

  const handleUp = useCallback(() => {
    setPressed(false);
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.stop();
      recognitionRef.current = null;
    }

    const text = transcriptRef.current.trim();
    if (text) {
      onTranscript(text);
    }

    setTimeout(() => setTranscript(""), 3000);
  }, [onTranscript]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        zIndex: 10,
        fontFamily: "monospace",
      }}
    >
      {transcript && (
        <div
          style={{
            background: "rgba(0,0,0,0.7)",
            border: "1px solid rgba(255,255,255,0.15)",
            color: "#ccc",
            padding: "6px 14px",
            borderRadius: 4,
            fontSize: 13,
            maxWidth: 400,
            textAlign: "center",
          }}
        >
          {transcript}
        </div>
      )}
      <button
        onMouseDown={handleDown}
        onMouseUp={handleUp}
        onMouseLeave={() => { if (pressed) handleUp(); }}
        onTouchStart={(e) => {
          e.preventDefault();
          handleDown();
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          handleUp();
        }}
        style={{
          width: 72,
          height: 72,
          borderRadius: "50%",
          border: `2px solid ${pressed ? "#ff4422" : "rgba(255,255,255,0.2)"}`,
          background: pressed
            ? "radial-gradient(circle, rgba(255,68,34,0.4) 0%, rgba(255,68,34,0.1) 70%)"
            : "rgba(255,255,255,0.06)",
          color: pressed ? "#ff6644" : "#888",
          cursor: "pointer",
          fontFamily: "monospace",
          fontSize: 10,
          fontWeight: "bold",
          textTransform: "uppercase",
          letterSpacing: 1,
          transition: "all 0.15s ease",
          boxShadow: pressed
            ? "0 0 20px rgba(255,68,34,0.3), inset 0 0 12px rgba(255,68,34,0.2)"
            : "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        {pressed ? "..." : "SPEAK"}
      </button>
      {connectionState !== "connected" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            color: connectionState === "connecting" ? "#aa8833" : "#cc4444",
          }}
        >
          <div style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: connectionState === "connecting" ? "#aa8833" : "#cc4444",
          }} />
          {connectionState === "connecting" ? "connecting..." : "disconnected"}
        </div>
      )}
    </div>
  );
}
