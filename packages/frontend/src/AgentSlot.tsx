import { useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { GolemFace, type GolemFaceHandle } from "./GolemFace";
import { SubagentFace } from "./SubagentFace";
import { useSubagentManager } from "./hooks/useSubagentManager";
import type { GolemEvent } from "@golem-code/types";

export type AgentSlotHandle = {
  handleEvent: (event: GolemEvent) => void;
};

type AgentSlotProps = {
  agentId: string;
  seed: number;
  color: string;
  /** X position in scene units (for row layout) */
  positionX: number;
  /** Override viewport width for subagent wander bounds */
  boundsWidth?: number;
  /** Scale factor for the main face (default 1.0) */
  faceScale?: number;
};

/**
 * Self-contained agent face with its own subagent management.
 * Exposes an imperative handleEvent method for the parent to route events.
 */
export const AgentSlot = forwardRef<AgentSlotHandle, AgentSlotProps>(
  function AgentSlot({ agentId, seed, color, positionX, boundsWidth, faceScale = 1 }, ref) {
    const faceRef = useRef<GolemFaceHandle>(null);
    const activeToolCount = useRef(0);
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
        // Only handle events for this agent
        if ("agentId" in event && event.agentId !== agentId) return;

        switch (event.type) {
          case "tool:start":
            faceRef.current?.setExpression("neutral");
            incrementTools();
            break;
          case "tool:end":
            decrementTools();
            // Reset permission-waiting state now that the tool completed
            faceRef.current?.setExpression("neutral");
            faceRef.current?.stopEnvSpin();
            if (activeToolCount.current > 0) {
              faceRef.current?.startEyeGlow();
            }
            break;
          case "subagent:start":
            incrementTools();
            subagents.spawnSubagent(event.toolUseId, event.description);
            break;
          case "subagent:end":
            decrementTools();
            subagents.markRemoving(event.toolUseId);
            break;
          case "permission:request":
            // Waiting for user approval — show alert expression + spin env map
            faceRef.current?.setExpression("oh");
            faceRef.current?.stopEyeGlow();
            faceRef.current?.startEnvSpin();
            break;
          case "activity":
            if (event.state === "idle") {
              faceRef.current?.stopEyeGlow();
            }
            break;
          case "turn:end":
            activeToolCount.current = 0;
            faceRef.current?.stopEyeGlow();
            faceRef.current?.stopEnvSpin();
            faceRef.current?.setExpression("neutral");
            subagents.markAllRemoving();
            break;
        }
      },
      [agentId, subagents],
    );

    useImperativeHandle(ref, () => ({ handleEvent }), [handleEvent]);

    return (
      <group position={[positionX, 0, 0]}>
        <group scale={faceScale}>
          <GolemFace ref={faceRef} seed={seed} color={color} />
        </group>
        {subagents.activeSubagents.map((sub) => (
          <SubagentFace
            key={sub.toolUseId}
            subagent={sub}
            positions={subagents.subagentPositions}
            targetScale={subagents.targetScale}
            removing={subagents.removingSubagents.has(sub.toolUseId)}
            onRemoved={() => subagents.onSubagentRemoved(sub.toolUseId)}
            boundsWidth={boundsWidth}
            faceScale={faceScale}
          />
        ))}
      </group>
    );
  },
);
