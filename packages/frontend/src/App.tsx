import { useRef, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { EffectComposer, Pixelation, Noise, Vignette, Bloom } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { GolemFace, type GolemFaceHandle } from "./GolemFace";
import { DevPanel } from "./DevPanel";
import { getRandomUnusedColor } from "./faceGen";
import { VoiceButton } from "./VoiceButton";
import { OutputPanel, type OutputEntry, summarizeToolInput, formatToolResult } from "./OutputPanel";
import { useGolemSocket } from "./useGolemSocket";
import { useVoiceCapture } from "./audio/useVoiceCapture";
import { useAudioPlayback } from "./audio/useAudioPlayback";
import type { GolemEvent, GolemCommand } from "@golem-code/types";

export function App() {
  const faceRef = useRef<GolemFaceHandle>(null);
  const [transcript, setTranscript] = useState("");
  const [autoApprove, setAutoApprove] = useState(true);
  const autoApproveRef = useRef(true);
  const activeToolCount = useRef(0);
  const sendCommandRef = useRef<(cmd: GolemCommand) => void>(undefined);

  // Output panel state
  const [faceSeed, setFaceSeed] = useState<number | undefined>(undefined);
  const [faceColor, setFaceColor] = useState<string | undefined>(undefined);
  const usedColors = useRef(new Set<string>());
  const [panelOpen, setPanelOpen] = useState(false);
  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([]);
  const textBufferRef = useRef("");
  const thinkingBufferRef = useRef("");
  const rafRef = useRef<number>(0);

  // Flush accumulated text buffer into an entry
  const flushTextBuffer = useCallback(() => {
    if (textBufferRef.current) {
      const text = textBufferRef.current;
      textBufferRef.current = "";
      setOutputEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.kind === "text" && last.streaming) {
          // Finalize the streaming entry with final accumulated text
          return [...prev.slice(0, -1), { kind: "text", text: last.text + text, streaming: false }];
        }
        return [...prev, { kind: "text", text, streaming: false }];
      });
    }
  }, []);

  // Flush accumulated thinking buffer into an entry
  const flushThinkingBuffer = useCallback(() => {
    if (thinkingBufferRef.current) {
      const text = thinkingBufferRef.current;
      thinkingBufferRef.current = "";
      setOutputEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.kind === "thinking" && last.streaming) {
          return [...prev.slice(0, -1), { kind: "thinking", text: last.text + text, streaming: false }];
        }
        return [...prev, { kind: "thinking", text, streaming: false }];
      });
    }
  }, []);

  // Schedule a rAF-throttled render of streaming buffers
  const scheduleStreamRender = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      // Render current text buffer state
      if (textBufferRef.current) {
        const text = textBufferRef.current;
        setOutputEntries((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === "text" && last.streaming) {
            return [...prev.slice(0, -1), { kind: "text", text: last.text + text, streaming: true }];
          }
          return [...prev, { kind: "text", text, streaming: true }];
        });
        textBufferRef.current = "";
      }
      // Render current thinking buffer state
      if (thinkingBufferRef.current) {
        const text = thinkingBufferRef.current;
        setOutputEntries((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === "thinking" && last.streaming) {
            return [...prev.slice(0, -1), { kind: "thinking", text: last.text + text, streaming: true }];
          }
          return [...prev, { kind: "thinking", text, streaming: true }];
        });
        thinkingBufferRef.current = "";
      }
    });
  }, []);

  const { onTtsStart, feedAudioChunk, onTtsEnd } = useAudioPlayback({
    onPlaybackComplete: () => {
      faceRef.current?.stopSpeaking();
    },
  });

  const handleEvent = useCallback(
    (event: GolemEvent) => {
      switch (event.type) {
        case "session:init":
          setPanelOpen(true);
          textBufferRef.current = "";
          thinkingBufferRef.current = "";
          break;

        case "text:delta":
          // Flush any pending thinking buffer first
          flushThinkingBuffer();
          textBufferRef.current += event.text;
          scheduleStreamRender();
          break;

        case "thinking:delta":
          // Flush any pending text buffer first
          flushTextBuffer();
          thinkingBufferRef.current += event.text;
          scheduleStreamRender();
          break;

        case "stt:transcript":
          setTranscript(event.text);
          if (event.isFinal) {
            setOutputEntries((prev) => [...prev, { kind: "user-message", text: event.text }]);
            setTimeout(() => setTranscript(""), 3000);
          }
          break;

        case "permission:request": {
          const summary = summarizeToolInput(event.toolName, event.toolInput);
          if (autoApproveRef.current) {
            sendCommandRef.current?.({
              type: "permission:response",
              requestId: event.requestId,
              decision: "allow",
            });
            setOutputEntries((prev) => [
              ...prev,
              { kind: "permission-request", requestId: event.requestId, toolName: event.toolName, summary, status: "approved" as const },
            ]);
          } else {
            setOutputEntries((prev) => [
              ...prev,
              {
                kind: "permission-request",
                requestId: event.requestId,
                toolName: event.toolName,
                summary,
                status: "pending" as const,
                decisionReason: event.decisionReason,
                suggestions: event.suggestions,
              },
            ]);
          }
          break;
        }

        case "tool:start":
          activeToolCount.current++;
          faceRef.current?.startEyeGlow();
          // Flush streaming buffers
          flushTextBuffer();
          flushThinkingBuffer();
          // Route Edit tool with old_string/new_string to a diff view
          if (
            event.toolName === "Edit" &&
            typeof event.input.old_string === "string" &&
            typeof event.input.new_string === "string"
          ) {
            setOutputEntries((prev) => [
              ...prev,
              {
                kind: "edit-diff",
                filePath: String(event.input.file_path ?? ""),
                oldString: event.input.old_string as string,
                newString: event.input.new_string as string,
              },
            ]);
          } else {
            setOutputEntries((prev) => [
              ...prev,
              { kind: "tool-start", toolName: event.toolName, summary: summarizeToolInput(event.toolName, event.input) },
            ]);
          }
          break;

        case "tool:result":
          activeToolCount.current = Math.max(0, activeToolCount.current - 1);
          if (activeToolCount.current === 0) {
            faceRef.current?.stopEyeGlow();
          }
          // Add tool-result entry
          setOutputEntries((prev) => [
            ...prev,
            { kind: "tool-result", text: formatToolResult(event.result) },
          ]);
          break;

        case "tool:summary":
          setOutputEntries((prev) => [
            ...prev,
            { kind: "tool-summary", summary: event.summary },
          ]);
          break;

        case "status:update":
          setOutputEntries((prev) => [
            ...prev,
            { kind: "status-update", status: event.status },
          ]);
          break;

        case "session:result":
          activeToolCount.current = 0;
          faceRef.current?.stopEyeGlow();
          // Flush buffers, add session-result entry
          flushTextBuffer();
          flushThinkingBuffer();
          setOutputEntries((prev) => [
            ...prev,
            {
              kind: "session-result",
              cost: event.totalCostUsd,
              inputTokens: event.inputTokens,
              outputTokens: event.outputTokens,
              durationMs: event.durationMs,
            },
          ]);
          break;

        case "conversation:cleared":
          setPanelOpen(false);
          setOutputEntries([]);
          textBufferRef.current = "";
          thinkingBufferRef.current = "";
          break;

        case "tts:start":
          onTtsStart(event.sampleRate);
          faceRef.current?.startSpeaking();
          break;

        case "tts:end":
          onTtsEnd();
          break;
      }
    },
    [onTtsStart, onTtsEnd, flushTextBuffer, flushThinkingBuffer, scheduleStreamRender],
  );

  const handlePermissionRespond = useCallback(
    (requestId: string, decision: "allow" | "allow-always" | "deny") => {
      sendCommandRef.current?.({
        type: "permission:response",
        requestId,
        decision,
      });
      const statusMap = {
        "allow": "approved" as const,
        "allow-always": "always-approved" as const,
        "deny": "denied" as const,
      };
      setOutputEntries((prev) =>
        prev.map((entry) =>
          entry.kind === "permission-request" && entry.requestId === requestId
            ? { ...entry, status: statusMap[decision] }
            : entry,
        ),
      );
    },
    [],
  );

  const handleToggleAutoApprove = useCallback(() => {
    setAutoApprove((prev) => {
      const next = !prev;
      autoApproveRef.current = next;
      return next;
    });
  }, []);

  const { sendCommand, getSocket } = useGolemSocket({
    onEvent: handleEvent,
    onAudioChunk: feedAudioChunk,
  });
  sendCommandRef.current = sendCommand;

  const handleClosePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const { startRecording, stopRecording } = useVoiceCapture({ getSocket });

  const handleVoiceStart = useCallback(() => {
    startRecording();
    faceRef.current?.lookAtRandom();
  }, [startRecording]);

  const handleVoiceEnd = useCallback(() => {
    stopRecording();
    faceRef.current?.lookCenter();
  }, [stopRecording]);

  return (
    <>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 5], zoom: 180 }}
        gl={{ antialias: true, toneMapping: 3 /* ACESFilmic */ }}
      >
        <color attach="background" args={["#1a0a0a"]} />
        <fog attach="fog" args={["#1a0a0a", 8, 20]} />
        <Environment files="/studio_kominka_02_1k.hdr" background={false} environmentIntensity={3.0} environmentRotation={[(-15 * Math.PI) / 180, (-15 * Math.PI) / 180, 0]} />
        <directionalLight position={[0, -2, 3]} intensity={4} color="#ff6644" />
        <GolemFace ref={faceRef} slideLeft={panelOpen} seed={faceSeed} color={faceColor} />
        <OrbitControls enablePan={false} />
        <EffectComposer>
          <Pixelation granularity={10} />
          <Bloom luminanceThreshold={0.3} luminanceSmoothing={0.9} intensity={0.8} />
          <Noise opacity={0.15} blendFunction={BlendFunction.OVERLAY} />
          <Vignette offset={0.3} darkness={0.7} />
        </EffectComposer>
      </Canvas>
      <DevPanel
        faceRef={faceRef}
        onClearConversation={() => sendCommand({ type: "conversation:clear" })}
        autoApprove={autoApprove}
        onToggleAutoApprove={handleToggleAutoApprove}
        onRandomFace={() => setFaceSeed(Math.floor(Math.random() * 2 ** 32))}
        onResetFace={() => setFaceSeed(undefined)}
        onRandomColor={() => {
          const color = getRandomUnusedColor(usedColors.current);
          usedColors.current.add(color);
          setFaceColor(color);
        }}
        onResetColor={() => {
          usedColors.current.clear();
          setFaceColor(undefined);
        }}
      />
      <OutputPanel open={panelOpen} entries={outputEntries} onClose={handleClosePanel} onPermissionRespond={handlePermissionRespond} />
      <VoiceButton
        onPressStart={handleVoiceStart}
        onPressEnd={handleVoiceEnd}
        transcript={transcript}
        panelOpen={panelOpen}
      />
    </>
  );
}
