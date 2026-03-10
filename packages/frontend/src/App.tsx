import { useRef, useState, useCallback, useMemo, type ReactNode } from "react";
import { useThree } from "@react-three/fiber";
import { AgentSlot, type AgentSlotHandle } from "./AgentSlot";
import { GolemScene, type SceneMode } from "./GolemScene";
import { DevPanel } from "./DevPanel";
import { getRandomUnusedColor } from "./faceGen";
import { VoiceButton } from "./VoiceButton";
import { useGolemSocket } from "./useGolemSocket";
import { useAgentManager, type AgentInfo } from "./hooks/useAgentManager";
import type { GolemEvent } from "@golem-code/types";
import type { GolemFaceHandle } from "./GolemFace";

const SCENE_MODE: SceneMode =
  new URLSearchParams(window.location.search).get("mode") === "overlay"
    ? "overlay"
    : "browser";

/** Spacing between agent faces in scene units */
const AGENT_SPACING = 2.5;

/**
 * Anchors scene content to the bottom-right in overlay mode.
 * In browser mode, renders children as-is (centered).
 */
function SceneAnchor({ mode, children }: { mode: SceneMode; children: ReactNode }) {
  const { viewport } = useThree();
  if (mode !== "overlay") return <>{children}</>;

  // Inset from viewport edge so horns/ears/bob animation aren't clipped
  const padX = 0.45;
  const padY = 0.55;
  return (
    <group position={[viewport.width / 2 - padX, -viewport.height / 2 + padY, 0]}>
      {children}
    </group>
  );
}

export function App() {
  const { agents, addAgent, removeAgent } = useAgentManager();

  // Map of agentId → AgentSlotHandle ref for routing events
  const slotRefs = useRef(new Map<string, React.RefObject<AgentSlotHandle | null>>());

  // Ensure a ref exists for each agent
  function getSlotRef(agentId: string): React.RefObject<AgentSlotHandle | null> {
    let ref = slotRefs.current.get(agentId);
    if (!ref) {
      ref = { current: null };
      slotRefs.current.set(agentId, ref);
    }
    return ref;
  }

  const handleEvent = useCallback(
    (event: GolemEvent) => {
      switch (event.type) {
        case "agent:init":
          addAgent(event.agentId, event.seed, event.color);
          break;

        case "agent:disconnect":
          removeAgent(event.agentId);
          slotRefs.current.delete(event.agentId);
          break;

        default:
          // Route to the correct AgentSlot by agentId
          if ("agentId" in event) {
            const ref = slotRefs.current.get(event.agentId);
            ref?.current?.handleEvent(event);
          }
          break;
      }
    },
    [addAgent, removeAgent],
  );

  const { sendCommand, connectionState } = useGolemSocket({
    onEvent: handleEvent,
  });

  const handleVoiceTranscript = useCallback(
    (text: string) => {
      sendCommand({ type: "inject", text });
    },
    [sendCommand],
  );

  // Compute X positions: right-aligned for overlay, centered for browser
  const agentPositions = useMemo(() => {
    const count = agents.length;
    if (SCENE_MODE === "overlay") {
      // Right-aligned: rightmost agent at x=0, others stack left
      return agents.map((_, i) => -(count - 1 - i) * AGENT_SPACING);
    }
    const totalWidth = (count - 1) * AGENT_SPACING;
    const startX = -totalWidth / 2;
    return agents.map((_, i) => startX + i * AGENT_SPACING);
  }, [agents.length]);

  // When multiple agents, constrain each subagent's wander bounds to its slot
  const boundsWidth = agents.length <= 1 ? undefined : AGENT_SPACING;

  // Scale face down in overlay mode so it fits the small viewport height
  const faceScale = SCENE_MODE === "overlay" ? 0.18 : 1;

  // For DevPanel compatibility, expose the first agent's face ref
  const firstAgentRef = agents.length > 0 ? getSlotRef(agents[0].agentId) : null;

  return (
    <>
      <GolemScene mode={SCENE_MODE}>
        <SceneAnchor mode={SCENE_MODE}>
          {agents.map((agent, i) => (
            <AgentSlot
              key={agent.agentId}
              ref={getSlotRef(agent.agentId)}
              agentId={agent.agentId}
              seed={agent.seed}
              color={agent.color}
              positionX={agentPositions[i]}
              boundsWidth={boundsWidth}
              faceScale={faceScale}
            />
          ))}
        </SceneAnchor>
      </GolemScene>
      {SCENE_MODE === "browser" && (
        <>
          <DevPanel
            faceRef={firstAgentRef as any}
            onRandomFace={() => {}}
            onResetFace={() => {}}
            onRandomColor={() => {}}
            onResetColor={() => {}}
            subagentCount={0}
            onSpawnSubagent={() => {}}
            onRemoveSubagent={() => {}}
            onRemoveAllSubagents={() => {}}
          />
          <VoiceButton
            onTranscript={handleVoiceTranscript}
            connectionState={connectionState}
          />
        </>
      )}
    </>
  );
}
