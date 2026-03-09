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
import { useGolemSocket } from "./useGolemSocket";
import { useSubagentManager } from "./hooks/useSubagentManager";
import type { GolemEvent } from "@golem-code/types";

export function App() {
  const faceRef = useRef<GolemFaceHandle>(null);
  const activeToolCount = useRef(0);

  const [faceSeed, setFaceSeed] = useState<number | undefined>(undefined);
  const [faceColor, setFaceColor] = useState<string | undefined>(undefined);
  const usedColors = useRef(new Set<string>());

  const subagents = useSubagentManager();

  function incrementTools() {
    activeToolCount.current++;
    faceRef.current?.startEyeGlow();
  }

  function decrementTools() {
    activeToolCount.current = Math.max(0, activeToolCount.current - 1);
    if (activeToolCount.current === 0) {
      faceRef.current?.stopEyeGlow();
    }
  }

  const handleEvent = useCallback(
    (event: GolemEvent) => {
      switch (event.type) {
        case "tool:start":
          incrementTools();
          break;

        case "tool:end":
          decrementTools();
          break;

        case "subagent:start":
          incrementTools();
          subagents.spawnSubagent(event.toolUseId, event.description);
          break;

        case "subagent:end":
          decrementTools();
          subagents.markRemoving(event.toolUseId);
          break;

        case "activity":
          if (event.state === "idle") {
            faceRef.current?.stopEyeGlow();
          }
          break;

        case "turn:end":
          activeToolCount.current = 0;
          faceRef.current?.stopEyeGlow();
          subagents.markAllRemoving();
          break;

        case "agent:init":
          setFaceSeed(event.seed);
          setFaceColor(event.color);
          break;
      }
    },
    [subagents],
  );

  const { sendCommand, connectionState } = useGolemSocket({
    onEvent: handleEvent,
  });

  const handleVoiceTranscript = useCallback((text: string) => {
    sendCommand({ type: "inject", text });
  }, [sendCommand]);

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
        <GolemFace ref={faceRef} seed={faceSeed} color={faceColor} />
        {subagents.activeSubagents.map((sub) => (
          <SubagentFace
            key={sub.toolUseId}
            subagent={sub}
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
      <VoiceButton
        onTranscript={handleVoiceTranscript}
        connectionState={connectionState}
      />
    </>
  );
}
