import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GolemFace, type GolemFaceHandle } from "./GolemFace";

// Frame-rate independent lerp
function damp(current: number, target: number, speed: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-speed * delta));
}

export type ActiveSubagent = {
  toolUseId: string;
  seed: number;
  color: string;
  description: string;
  /** Layered sine frequencies/phases for continuous smooth motion */
  freqX1: number;
  freqX2: number;
  freqY1: number;
  freqY2: number;
  phaseX1: number;
  phaseX2: number;
  phaseY1: number;
  phaseY2: number;
};

/** Shared map of current subagent world positions, written each frame */
export type SubagentPositions = Map<string, { x: number; y: number }>;

type SubagentFaceProps = {
  subagent: ActiveSubagent;
  panelOpen: boolean;
  positions: React.RefObject<SubagentPositions>;
  targetScale: number;
  removing?: boolean;
  onRemoved?: () => void;
};

const BASE_SCALE = 0.27;
const BASE_REPULSE_THRESHOLD = 1.2;
const BASE_REPULSE_STRENGTH = 0.6;
/** Fraction of viewport to use as padding on each edge */
const PADDING = 0.08;

export function SubagentFace({ subagent, panelOpen, positions, targetScale, removing, onRemoved }: SubagentFaceProps) {
  const groupRef = useRef<THREE.Group>(null);
  const faceRef = useRef<GolemFaceHandle>(null);
  const scaleRef = useRef(0);
  const glowStarted = useRef(false);
  // Damped repulsion offset — smooths out avoidance forces
  const repulseRef = useRef({ x: 0, y: 0 });
  // Damped wander bounds for smooth panel open/close transition
  const boundsRef = useRef({ centerX: 0, halfW: 1, halfH: 1 });

  const { viewport } = useThree();

  // Start eye glow once mounted
  useEffect(() => {
    if (!glowStarted.current && faceRef.current) {
      faceRef.current.startEyeGlow();
      glowStarted.current = true;
    }
  }, []);

  // Clean up shared position on unmount
  useEffect(() => {
    return () => {
      positions.current?.delete(subagent.toolUseId);
    };
  }, [subagent.toolUseId, positions]);

  useFrame(({ clock }, delta) => {
    const d = Math.min(delta, 0.1);
    const t = clock.getElapsedTime();

    if (!groupRef.current) return;

    // Trigger eye glow on first frame if not yet started
    if (!glowStarted.current && faceRef.current) {
      faceRef.current.startEyeGlow();
      glowStarted.current = true;
    }

    // Pop-in / pop-out scale (targetScale adjusts for crowd density)
    if (removing) {
      scaleRef.current = damp(scaleRef.current, 0, 6, d);
      if (scaleRef.current < 0.005) {
        onRemoved?.();
        return;
      }
    } else {
      scaleRef.current = damp(scaleRef.current, targetScale, 6, d);
    }

    const s = scaleRef.current;
    groupRef.current.scale.set(s, s, s);

    // Compute and smoothly damp wander bounds based on viewport and panel state
    const vw = viewport.width;
    const vh = viewport.height;
    const padX = vw * PADDING;
    const padY = vh * PADDING;
    // Panel open: left half of screen. Panel closed: full screen.
    const targetCenterX = panelOpen ? -vw / 4 : 0;
    const targetHalfW = (panelOpen ? vw / 4 : vw / 2) - padX;
    const targetHalfH = vh / 2 - padY;

    const b = boundsRef.current;
    b.centerX = damp(b.centerX, targetCenterX, 5, d);
    b.halfW = damp(b.halfW, targetHalfW, 5, d);
    b.halfH = damp(b.halfH, targetHalfH, 5, d);

    // Continuous smooth motion via layered sine waves
    // Sine outputs are in [-1, 1] normalized range, then mapped to bounds
    const { freqX1, freqX2, freqY1, freqY2, phaseX1, phaseX2, phaseY1, phaseY2 } = subagent;
    const normX = Math.sin(t * freqX1 + phaseX1) * 0.67 + Math.sin(t * freqX2 + phaseX2) * 0.33;
    const normY = Math.sin(t * freqY1 + phaseY1) * 0.6 + Math.sin(t * freqY2 + phaseY2) * 0.4;

    const desiredX = b.centerX + normX * b.halfW;
    const desiredY = normY * b.halfH;

    // Compute repulsion from nearby subagents
    // Scale repulsion distance and strength with current size so small faces don't fly apart
    const scaleFactor = s / BASE_SCALE;
    const repulseThreshold = BASE_REPULSE_THRESHOLD * scaleFactor;
    const repulseStrength = BASE_REPULSE_STRENGTH * scaleFactor;
    let pushX = 0;
    let pushY = 0;
    const map = positions.current;
    if (map) {
      for (const [id, pos] of map) {
        if (id === subagent.toolUseId) continue;
        const dx = desiredX - pos.x;
        const dy = desiredY - pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < repulseThreshold && dist > 0.001) {
          // Linear falloff: full strength at dist=0, zero at threshold
          const strength = repulseStrength * (1 - dist / repulseThreshold);
          pushX += (dx / dist) * strength;
          pushY += (dy / dist) * strength;
        }
      }
    }

    // Damp the repulsion offset so it builds/fades gradually
    const r = repulseRef.current;
    r.x = damp(r.x, pushX, 3, d);
    r.y = damp(r.y, pushY, 3, d);

    const finalX = desiredX + r.x;
    const finalY = desiredY + r.y;

    groupRef.current.position.set(finalX, finalY, 1.0);

    // Write position to shared map for other faces to read
    if (map) {
      map.set(subagent.toolUseId, { x: finalX, y: finalY });
    }
  });

  return (
    <group ref={groupRef}>
      <GolemFace seed={subagent.seed} color={subagent.color} ref={faceRef} />
    </group>
  );
}
