import { useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GolemFace, type GolemFaceHandle } from "./GolemFace";
import { SubagentFace } from "./SubagentFace";
import { useSubagentManager } from "./hooks/useSubagentManager";
import type { GolemEvent } from "@golem-code/types";

// Frame-rate independent lerp
function damp(current: number, target: number, speed: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-speed * delta));
}

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
  /** Whether this agent is being removed (animating out) */
  removing?: boolean;
  /** Called when the exit animation completes */
  onRemoved?: () => void;
};

/**
 * Self-contained agent face with its own subagent management.
 * Exposes an imperative handleEvent method for the parent to route events.
 * Handles spawn (scale from 0) and exit (scale to 0) animations.
 */
export const AgentSlot = forwardRef<AgentSlotHandle, AgentSlotProps>(
  function AgentSlot({ agentId, seed, color, positionX, boundsWidth, faceScale = 1, removing, onRemoved }, ref) {
    const faceRef = useRef<GolemFaceHandle>(null);
    const groupRef = useRef<THREE.Group>(null);
    const activeToolCount = useRef(0);
    const subagents = useSubagentManager();

    // Animation state
    const scaleRef = useRef(0); // start at 0 for spawn animation
    const currentPosX = useRef<number | null>(null); // null = snap on first frame

    function incrementTools() {
      activeToolCount.current++;
    }

    function decrementTools() {
      activeToolCount.current = Math.max(0, activeToolCount.current - 1);
    }

    const handleEvent = useCallback(
      (event: GolemEvent) => {
        // Only handle events for this agent
        if ("agentId" in event && event.agentId !== agentId) return;

        switch (event.type) {
          case "tool:start":
            faceRef.current?.setExpression("smile");
            incrementTools();
            break;
          case "tool:end":
            decrementTools();
            faceRef.current?.stopEnvSpin();
            if (activeToolCount.current === 0) {
              faceRef.current?.setExpression("neutral");
            }
            break;
          case "subagent:start":
            incrementTools();
            subagents.spawnSubagent(event.toolUseId, event.description);
            break;
          case "subagent:end":
            decrementTools();
            subagents.markRemoving(event.toolUseId);
            if (activeToolCount.current === 0) {
              faceRef.current?.setExpression("neutral");
            }
            break;
          case "permission:request":
            // Waiting for user approval — show alert expression + spin env map
            faceRef.current?.setExpression("oh");
            faceRef.current?.startEnvSpin();
            break;
          case "activity":
            if (event.state === "active") {
              faceRef.current?.startEyeGlow();
            } else if (event.state === "idle") {
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

    // Animate scale and position each frame
    useFrame((_, delta) => {
      const d = Math.min(delta, 0.1);
      if (!groupRef.current) return;

      // Scale animation: spawn in or remove out
      const targetScale = removing ? 0 : faceScale;
      scaleRef.current = damp(scaleRef.current, targetScale, 6, d);

      if (removing && scaleRef.current < 0.005) {
        onRemoved?.();
        return;
      }

      const s = scaleRef.current;
      groupRef.current.scale.set(s, s, s);

      // Smooth position transition
      if (currentPosX.current === null) {
        currentPosX.current = positionX;
      } else {
        currentPosX.current = damp(currentPosX.current, positionX, 5, d);
      }
      groupRef.current.position.x = currentPosX.current;
    });

    return (
      <group ref={groupRef}>
        <GolemFace ref={faceRef} seed={seed} color={color} />
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
