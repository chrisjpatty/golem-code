import { useRef, useState, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { EffectComposer, Pixelation, Noise, Vignette, Bloom } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { GolemFace, type GolemFaceHandle } from "./GolemFace";
import { SubagentFace } from "./SubagentFace";
import { DevPanel } from "./DevPanel";
import { getRandomUnusedColor } from "./faceGen";
import { VoiceButton } from "./VoiceButton";
import { OutputPanel } from "./OutputPanel";
import { useGolemSocket } from "./useGolemSocket";
import { useVoiceCapture } from "./audio/useVoiceCapture";
import { useAudioPlayback } from "./audio/useAudioPlayback";
import { useStreamingBuffers } from "./hooks/useStreamingBuffers";
import { useSubagentManager } from "./hooks/useSubagentManager";
import { usePermissions } from "./hooks/usePermissions";
import { useQuestions } from "./hooks/useQuestions";
import { useChatInput } from "./hooks/useChatInput";
import { useOutputEntries } from "./hooks/useOutputEntries";
import type { GolemEvent, GolemCommand } from "@golem-code/types";

export function App() {
  const faceRef = useRef<GolemFaceHandle>(null);
  const [transcript, setTranscript] = useState("");
  const activeToolCount = useRef(0);
  const sendCommandRef = useRef<(cmd: GolemCommand) => void>(undefined);
  const toolNameMap = useRef(new Map<string, string>());

  const [faceSeed, setFaceSeed] = useState<number | undefined>(undefined);
  const [faceColor, setFaceColor] = useState<string | undefined>(undefined);
  const usedColors = useRef(new Set<string>());

  // Composed hooks
  const entries = useOutputEntries();
  const streaming = useStreamingBuffers(entries.setOutputEntries);
  const permissions = usePermissions(sendCommandRef, entries.setOutputEntries);
  const questions = useQuestions(sendCommandRef, entries.setOutputEntries);
  const chatInput = useChatInput(sendCommandRef, entries.setOutputEntries);
  const subagents = useSubagentManager();

  const { onTtsStart, feedAudioChunk, onTtsEnd } = useAudioPlayback({
    onPlaybackComplete: () => {
      faceRef.current?.stopSpeaking();
    },
  });

  const handleEvent = useCallback(
    (event: GolemEvent) => {
      switch (event.type) {
        case "session:init":
          entries.openPanel();
          streaming.resetBuffers();
          chatInput.handleQueryStart();
          break;

        case "text:delta":
          streaming.appendTextDelta(event.text);
          break;

        case "thinking:delta":
          streaming.appendThinkingDelta(event.text);
          break;

        case "stt:transcript":
          setTranscript(event.text);
          if (event.isFinal) {
            entries.addUserMessage(event.text);
            setTimeout(() => setTranscript(""), 3000);
          }
          break;

        case "permission:request":
          permissions.handlePermissionRequest(event);
          break;

        case "question:ask":
          questions.handleQuestionAsk(event);
          break;

        case "tool:start":
          activeToolCount.current++;
          faceRef.current?.startEyeGlow();
          streaming.flushTextBuffer();
          streaming.flushThinkingBuffer();
          toolNameMap.current.set(event.toolUseId, event.toolName);
          // AskUserQuestion is handled via the question:ask / question:answer
          // flow (canUseTool intercept in server.ts), not as a regular tool entry.
          if (event.toolName === "AskUserQuestion") break;
          if (event.toolName === "Task") {
            subagents.spawnSubagent(
              event.toolUseId,
              typeof event.input.description === "string" ? event.input.description : "",
            );
          }
          entries.addToolStart(event.toolName, event.input);
          break;

        case "tool:result": {
          activeToolCount.current = Math.max(0, activeToolCount.current - 1);
          if (activeToolCount.current === 0) {
            faceRef.current?.stopEyeGlow();
          }
          subagents.markRemoving(event.toolUseId);
          const toolName = toolNameMap.current.get(event.toolUseId);
          // AskUserQuestion results are redundant — the QuestionResolvedBlock
          // already displays the answers in a nicer format.
          if (toolName !== "AskUserQuestion") {
            entries.addToolResult(event.result, toolName);
          }
          break;
        }

        case "tool:summary":
          entries.addToolSummary(event.summary);
          break;

        case "status:update":
          entries.addStatusUpdate(event.status);
          break;

        case "session:result":
          activeToolCount.current = 0;
          faceRef.current?.stopEyeGlow();
          subagents.markAllRemoving();
          streaming.flushTextBuffer();
          streaming.flushThinkingBuffer();
          entries.addSessionResult(event);
          chatInput.handleQueryEnd();
          break;

        case "conversation:cleared":
          entries.clearAll();
          subagents.clearAll();
          streaming.resetBuffers();
          chatInput.clearAll();
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
    [onTtsStart, onTtsEnd, streaming, entries, permissions, questions, chatInput, subagents],
  );

  const { sendCommand, getSocket, connectionState } = useGolemSocket({
    onEvent: handleEvent,
    onAudioChunk: feedAudioChunk,
  });
  sendCommandRef.current = sendCommand;

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
        <GolemFace ref={faceRef} slideLeft={entries.panelOpen} seed={faceSeed} color={faceColor} />
        {subagents.activeSubagents.map((sub) => (
          <SubagentFace
            key={sub.toolUseId}
            subagent={sub}
            panelOpen={entries.panelOpen}
            positions={subagents.subagentPositions}
            targetScale={subagents.targetScale}
            removing={subagents.removingSubagents.has(sub.toolUseId)}
            onRemoved={() => subagents.onSubagentRemoved(sub.toolUseId)}
          />
        ))}
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
        autoApprove={permissions.autoApprove}
        onToggleAutoApprove={permissions.toggleAutoApprove}
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
        subagentCount={subagents.activeSubagents.length}
        onSpawnSubagent={subagents.devSpawn}
        onRemoveSubagent={subagents.devRemoveOldest}
        onRemoveAllSubagents={subagents.markAllRemoving}
      />
      <OutputPanel
        open={entries.panelOpen}
        entries={entries.outputEntries}
        onClose={entries.closePanel}
        onPermissionRespond={permissions.handlePermissionRespond}
        onQuestionRespond={questions.handleQuestionRespond}
        chatInputText={chatInput.inputText}
        onChatInputChange={chatInput.setInputText}
        onChatSend={chatInput.sendMessage}
        onChatStop={chatInput.stopQuery}
        queryActive={chatInput.queryActive}
      />
      <VoiceButton
        onPressStart={handleVoiceStart}
        onPressEnd={handleVoiceEnd}
        transcript={transcript}
        panelOpen={entries.panelOpen}
        connectionState={connectionState}
      />
    </>
  );
}
