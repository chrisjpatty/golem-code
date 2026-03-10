import { useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  DEFAULT_FACE_PARAMS,
  generateFaceParams,
  createUpperFaceGeometry,
  createJawGeometry,
  createLeftEyeGeometry,
  createRightEyeGeometry,
} from "./faceGen";

// Frame-rate independent lerp: same visual result regardless of FPS
function damp(current: number, target: number, speed: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-speed * delta));
}

export type MouthExpression = 'neutral' | 'smile' | 'frown' | 'oh';

type ExpressionOffsets = {
  cornerDY: number;    // Y offset for upper mouth corners (19,20)
  cornerDX: number;    // X offset (widens/narrows) for mouth corners (upper + jaw)
  lipDY: number;       // Y offset for upper lip center (21)
  lipDZ: number;       // Z offset for upper lip center (21)
  jawCornerDY: number; // Y offset for jaw mouth corners (2,3)
  jawLipDY: number;    // Y offset for jaw lip center (4)
  jawLipDZ: number;    // Z offset for jaw lip center (4)
  hingeDY: number;     // Y offset for jaw hinges (upper 22,23 + jaw 0,1)
  cheekDY: number;     // Y offset for cheeks (upper 17,18)
  jawOpen: number;     // jaw group rotation offset
  jawDrop: number;     // jaw group Y position offset
};

const EXPRESSION_OFFSETS: Record<MouthExpression, ExpressionOffsets> = {
  neutral:  { cornerDY: 0,     cornerDX: 0,    lipDY: 0,     lipDZ: 0,    jawCornerDY: 0,    jawLipDY: 0,     jawLipDZ: 0,    hingeDY: 0,     cheekDY: 0,     jawOpen: 0,     jawDrop: 0 },
  // Smile: outer corners (hinges) UP most, inner mouth verts intermediate, lip centers DOWN
  smile:    { cornerDY: 0.04,  cornerDX: 0.04, lipDY: -0.12, lipDZ: 0.02, jawCornerDY: 0.04, jawLipDY: -0.12, jawLipDZ: 0.02, hingeDY: 0.2,   cheekDY: 0.1,   jawOpen: -0.02, jawDrop: 0 },
  // Frown: outer corners DOWN most, inner mouth verts intermediate, lip centers UP
  frown:    { cornerDY: 0.06,  cornerDX: 0,    lipDY: 0.12,  lipDZ: -0.01,jawCornerDY: 0.06, jawLipDY: 0.12,  jawLipDZ: 0,    hingeDY: -0.18, cheekDY: -0.08, jawOpen: 0.03,  jawDrop: 0.02 },
  // Oh: rounded O — upper lip arcs up, lower lip arcs down, corners narrow, jaw drops
  oh:       { cornerDY: 0.1,   cornerDX: -0.15,lipDY: 0.15,  lipDZ: 0.06, jawCornerDY: -0.1, jawLipDY: -0.15, jawLipDZ: 0.06, hingeDY: -0.08, cheekDY: 0,     jawOpen: 0.2,   jawDrop: 0.18 },
};

export type GolemFaceHandle = {
  startSpeaking: () => void;
  stopSpeaking: () => void;
  startEyeGlow: () => void;
  stopEyeGlow: () => void;
  lookAtRandom: () => void;
  lookCenter: () => void;
  headSnapLeft: () => void;
  headSnapRight: () => void;
  headSnapDownLeft: () => void;
  headSnapDownRight: () => void;
  headShake: () => void;
  headNod: () => void;
  setExpression: (expr: MouthExpression) => void;
  startEnvSpin: () => void;
  stopEnvSpin: () => void;
};

type EyeGlowPhase = "off" | "ramp" | "hold" | "fade";

/**
 * Low-poly golem face with diamond eye holes and a hinged jaw.
 *
 * The face is built from manually defined vertices and triangles.
 * The upper face (including eye sockets) is one mesh.
 * The jaw is a separate mesh that pivots at the jaw hinge.
 */

// -- Shared geometry builder with pre-allocated spike space --

function buildGlitchGeo(
  verts: [number, number, number][],
  faces: [number, number, number][]
): GlitchGeo {
  const baseVertCount = verts.length;
  const baseIndexCount = faces.length * 3;
  const totalVerts = baseVertCount + MAX_SPIKE_VERTS;
  const totalIndices = baseIndexCount + MAX_SPIKE_TRIS * 3;

  const positions = new Float32Array(totalVerts * 3);
  for (let i = 0; i < baseVertCount; i++) {
    positions[i * 3] = verts[i][0];
    positions[i * 3 + 1] = verts[i][1];
    positions[i * 3 + 2] = verts[i][2];
  }

  const indexArr = new Uint16Array(totalIndices);
  for (let i = 0; i < faces.length; i++) {
    indexArr[i * 3] = faces[i][0];
    indexArr[i * 3 + 1] = faces[i][1];
    indexArr[i * 3 + 2] = faces[i][2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(indexArr, 1));
  geo.setDrawRange(0, baseIndexCount);
  geo.computeVertexNormals();
  return { geo, baseVertCount, baseIndexCount };
}

// Extra capacity for glitch spike triangles baked into each geometry
const MAX_SPIKE_TRIS = 12;
const MAX_SPIKE_VERTS = MAX_SPIKE_TRIS * 3;

type GlitchGeo = {
  geo: THREE.BufferGeometry;
  baseVertCount: number;
  baseIndexCount: number;
};

function useVertexGlitch({ geo, baseVertCount, baseIndexCount }: GlitchGeo) {
  const origPositions = useMemo(() => {
    return new Float32Array(geo.getAttribute("position").array.slice(0, baseVertCount * 3));
  }, [geo, baseVertCount]);

  // Vertex jitter state
  const jitterState = useRef({
    nextGlitchAt: 0,
    restoreAt: 0,
    glitching: false,
    affectedVerts: [] as number[],
  });

  // Spike state
  const spikeState = useRef({
    nextSpikeAt: 2 + Math.random() * 3,
    removeAt: 0,
    active: false,
    triCount: 0,
  });

  const update = useCallback(
    (t: number) => {
      const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
      const pos = posAttr.array as Float32Array;
      const idxAttr = geo.getIndex()!;
      const idx = idxAttr.array as Uint16Array;
      let needsUpdate = false;

      // -- Vertex jitter --
      const js = jitterState.current;
      if (js.glitching && t > js.restoreAt) {
        for (const vi of js.affectedVerts) {
          pos[vi * 3] = origPositions[vi * 3];
          pos[vi * 3 + 1] = origPositions[vi * 3 + 1];
          pos[vi * 3 + 2] = origPositions[vi * 3 + 2];
        }
        js.glitching = false;
        js.affectedVerts = [];
        needsUpdate = true;
      }

      if (!js.glitching && t > js.nextGlitchAt) {
        const count = 2 + Math.floor(Math.random() * 3);
        const jitterAmount = 0.15;
        for (let i = 0; i < count; i++) {
          const vi = Math.floor(Math.random() * baseVertCount);
          js.affectedVerts.push(vi);
          pos[vi * 3] += (Math.random() - 0.5) * jitterAmount;
          pos[vi * 3 + 1] += (Math.random() - 0.5) * jitterAmount;
          pos[vi * 3 + 2] += (Math.random() - 0.5) * jitterAmount;
        }
        js.glitching = true;
        js.restoreAt = t + 0.05 + Math.random() * 0.1;
        js.nextGlitchAt = t + 1 + Math.random() * 4;
        needsUpdate = true;
      }

      // -- Spike triangles --
      const ss = spikeState.current;
      if (ss.active && t > ss.removeAt) {
        geo.setDrawRange(0, baseIndexCount);
        ss.active = false;
        needsUpdate = true;
      }

      if (!ss.active && t > ss.nextSpikeAt) {
        const triCount = 1 + Math.floor(Math.random() * 3);
        const spread = 0.15 + Math.random() * 0.1;
        const lift = 0.03 + Math.random() * 0.05;

        for (let tri = 0; tri < triCount; tri++) {
          // Pick a random vertex as the anchor
          const vi = Math.floor(Math.random() * baseVertCount);
          const bx = origPositions[vi * 3];
          const by = origPositions[vi * 3 + 1];
          const bz = origPositions[vi * 3 + 2];

          // Create a small flat triangle near the surface with slight offset
          const vertBase = baseVertCount + tri * 3;
          const vOff = vertBase * 3;
          for (let v = 0; v < 3; v++) {
            pos[vOff + v * 3] = bx + (Math.random() - 0.5) * spread;
            pos[vOff + v * 3 + 1] = by + (Math.random() - 0.5) * spread;
            pos[vOff + v * 3 + 2] = bz + lift + Math.random() * lift;
          }

          const idxBase = baseIndexCount + tri * 3;
          idx[idxBase] = vertBase;
          idx[idxBase + 1] = vertBase + 1;
          idx[idxBase + 2] = vertBase + 2;
        }

        idxAttr.needsUpdate = true;
        geo.setDrawRange(0, baseIndexCount + triCount * 3);
        ss.active = true;
        ss.triCount = triCount;
        ss.removeAt = t + 0.06 + Math.random() * 0.12;
        ss.nextSpikeAt = t + 2 + Math.random() * 5;
        needsUpdate = true;
      }

      if (needsUpdate) {
        posAttr.needsUpdate = true;
        geo.computeVertexNormals();
      }
    },
    [geo, origPositions, baseVertCount, baseIndexCount]
  );

  return update;
}

type GolemFaceProps = { slideLeft?: boolean; seed?: number; color?: string };

export const GolemFace = forwardRef<GolemFaceHandle, GolemFaceProps>(function GolemFace({ slideLeft = false, seed, color }, ref) {
  const groupRef = useRef<THREE.Group>(null);
  const jawRef = useRef<THREE.Group>(null);

  const params = useMemo(
    () => (seed != null ? generateFaceParams(seed) : DEFAULT_FACE_PARAMS),
    [seed]
  );

  const upper = useMemo(() => {
    const { verts, faces } = createUpperFaceGeometry(params);
    return buildGlitchGeo(verts, faces);
  }, [params]);
  const jaw = useMemo(() => {
    const { verts, faces } = createJawGeometry(params);
    return buildGlitchGeo(verts, faces);
  }, [params]);

  const glitchUpper = useVertexGlitch(upper);
  const glitchJaw = useVertexGlitch(jaw);

  // Eye glow
  const leftEyeGeo = useMemo(() => createLeftEyeGeometry(params), [params]);
  const rightEyeGeo = useMemo(() => createRightEyeGeometry(params), [params]);
  const leftEyeMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const rightEyeMatRef = useRef<THREE.MeshBasicMaterial>(null);

  const eyeGlow = useRef({
    phase: "off" as EyeGlowPhase,
    intensity: 0,
    nextFlickerAt: 0,
    flickerTarget: 1.0,
  });

  // Head gesture state
  const headGesture = useRef({
    type: "idle" as "idle" | "snap" | "shake" | "nod",
    phase: "idle" as "idle" | "snap" | "hold" | "return" | "windup" | "oscillate",
    currentY: 0,
    currentX: 0,
    targetY: 0,
    targetX: 0,
    holdUntil: 0,
    // For oscillating gestures (shake/nod)
    startedAt: 0,
    amplitude: 0,
    frequency: 0,
    cycles: 0,
    phaseOffset: 0,
  });

  // Speaking state
  const speaking = useRef({
    active: false,
    currentAngle: 0,
    targetAngle: 0,
    currentDrop: 0,
    targetDrop: 0,
    nextSyllableAt: 0,
  });

  // Material refs for per-agent env map rotation
  const upperMatRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const jawMatRef = useRef<THREE.MeshPhysicalMaterial>(null);

  // Env map spin state
  const ENV_SPIN_INTENSITY = 1.2;  // dimmed intensity while spinning
  const envSpin = useRef({
    active: false,
    speed: 0,        // current spin speed (radians/sec)
    targetSpeed: 0,   // target speed for damping
    angle: 0,         // spin offset added to base rotation (0 = at rest)
    baseX: 0,         // scene environmentRotation captured on spin start
    baseY: 0,
    baseZ: 0,
    sceneIntensity: 3.0,  // scene.environmentIntensity captured on start
    intensity: 3.0,       // current envMapIntensity (damped)
  });

  // Expression state
  const mouthExpr = useRef({
    target: 'neutral' as MouthExpression,
    currentOffsets: { cornerDY: 0, cornerDX: 0, lipDY: 0, lipDZ: 0, jawCornerDY: 0, jawLipDY: 0, jawLipDZ: 0, hingeDY: 0, cheekDY: 0, jawOpen: 0, jawDrop: 0 } as ExpressionOffsets,
  });

  // Store base positions for all expression-affected vertices
  const upperExprBase = useMemo(() => {
    const pos = upper.geo.getAttribute("position").array as Float32Array;
    const v = (i: number) => ({ x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] });
    return {
      v17: v(17), v18: v(18),   // cheeks
      v19: v(19), v20: v(20),   // mouth corners
      v21: v(21),               // upper lip center
      v22: v(22), v23: v(23),   // jaw hinges
    };
  }, [upper.geo]);

  const jawExprBase = useMemo(() => {
    const pos = jaw.geo.getAttribute("position").array as Float32Array;
    const v = (i: number) => ({ x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] });
    return {
      v0: v(0), v1: v(1),       // jaw hinges
      v2: v(2), v3: v(3),       // mouth corners
      v4: v(4),                  // lower lip center
    };
  }, [jaw.geo]);

  useImperativeHandle(ref, () => ({
    startSpeaking: () => {
      speaking.current.active = true;
      speaking.current.nextSyllableAt = 0;
    },
    stopSpeaking: () => {
      speaking.current.active = false;
    },
    startEyeGlow: () => {
      eyeGlow.current.phase = "ramp";
    },
    stopEyeGlow: () => {
      if (eyeGlow.current.phase !== "off") {
        eyeGlow.current.phase = "fade";
      }
    },
    lookAtRandom: () => {
      const hg = headGesture.current;
      hg.type = "snap";
      hg.phase = "snap";
      hg.targetY = (Math.random() * 2 - 1) * 0.6;
      hg.targetX = (Math.random() * 2 - 1) * 0.2;
      hg.holdUntil = Infinity;
    },
    lookCenter: () => {
      headGesture.current.phase = "return";
    },
    headSnapLeft: () => {
      const hg = headGesture.current;
      hg.type = "snap"; hg.phase = "snap";
      hg.targetY = -0.6; hg.targetX = -0.2; hg.holdUntil = 0;
    },
    headSnapRight: () => {
      const hg = headGesture.current;
      hg.type = "snap"; hg.phase = "snap";
      hg.targetY = 0.6; hg.targetX = -0.2; hg.holdUntil = 0;
    },
    headSnapDownLeft: () => {
      const hg = headGesture.current;
      hg.type = "snap"; hg.phase = "snap";
      hg.targetY = -0.6; hg.targetX = 0.2; hg.holdUntil = 0;
    },
    headSnapDownRight: () => {
      const hg = headGesture.current;
      hg.type = "snap"; hg.phase = "snap";
      hg.targetY = 0.6; hg.targetX = 0.2; hg.holdUntil = 0;
    },
    headShake: () => {
      const hg = headGesture.current;
      hg.type = "shake"; hg.phase = "windup";
      hg.startedAt = 0; hg.amplitude = 0.4; hg.frequency = 16; hg.cycles = 3;
      hg.targetY = 0.15; hg.targetX = 0;
    },
    headNod: () => {
      const hg = headGesture.current;
      hg.type = "nod"; hg.phase = "windup";
      hg.startedAt = 0; hg.amplitude = 0.25; hg.frequency = 10; hg.cycles = 2;
      hg.targetY = 0; hg.targetX = -0.12;
    },
    setExpression: (expr: MouthExpression) => {
      mouthExpr.current.target = expr;
    },
    startEnvSpin: () => {
      envSpin.current.active = true;
      envSpin.current.targetSpeed = 8;
      envSpin.current.angle = 0;
    },
    stopEnvSpin: () => {
      envSpin.current.targetSpeed = 0;
    },
  }));

  useFrame(({ clock, scene }, delta) => {
    const t = clock.getElapsedTime();
    const d = Math.min(delta, 0.1); // clamp to avoid huge jumps on tab refocus
    // Head movement
    if (groupRef.current) {
      groupRef.current.position.y = Math.sin(t * 0.5) * 0.12;

      // Slide left/right when output panel opens/closes
      const targetX = slideLeft ? -2.5 : 0;
      groupRef.current.position.x = damp(groupRef.current.position.x, targetX, 5, d);

      const hg = headGesture.current;
      if (hg.phase === "snap") {
        hg.currentY = damp(hg.currentY, hg.targetY, 40, d);
        hg.currentX = damp(hg.currentX, hg.targetX, 40, d);
        if (Math.abs(hg.currentY - hg.targetY) < 0.01) {
          hg.phase = "hold";
          if (isFinite(hg.holdUntil)) {
            hg.holdUntil = t + 1.0;
          }
        }
      } else if (hg.phase === "hold") {
        if (t > hg.holdUntil) {
          hg.phase = "return";
        }
      } else if (hg.phase === "windup") {
        hg.currentY = damp(hg.currentY, hg.targetY, 4, d);
        hg.currentX = damp(hg.currentX, hg.targetX, 4, d);
        if (Math.abs(hg.currentY - hg.targetY) < 0.005 && Math.abs(hg.currentX - hg.targetX) < 0.005) {
          hg.phase = "oscillate";
          hg.startedAt = 0;
          const windupVal = hg.type === "shake" ? hg.currentY : hg.currentX;
          hg.phaseOffset = Math.asin(Math.min(1, Math.max(-1, windupVal / hg.amplitude)));
        }
      } else if (hg.phase === "oscillate") {
        if (hg.startedAt === 0) hg.startedAt = t;
        const elapsed = t - hg.startedAt;
        const duration = hg.cycles * (Math.PI * 2 / hg.frequency);
        const decay = Math.max(0, 1 - elapsed / duration);
        const wave = Math.sin(elapsed * hg.frequency + hg.phaseOffset) * hg.amplitude * decay;

        if (hg.type === "shake") {
          hg.currentY = wave;
          hg.currentX = damp(hg.currentX, 0, 14, d);
        } else {
          hg.currentX = wave;
          hg.currentY = damp(hg.currentY, 0, 14, d);
        }

        if (decay <= 0) {
          hg.phase = "return";
        }
      } else if (hg.phase === "return") {
        hg.currentY = damp(hg.currentY, 0, 5, d);
        hg.currentX = damp(hg.currentX, 0, 5, d);
        if (Math.abs(hg.currentY) < 0.005 && Math.abs(hg.currentX) < 0.005) {
          hg.currentY = 0;
          hg.currentX = 0;
          hg.phase = "idle";
          hg.type = "idle";
        }
      }

      groupRef.current.rotation.y = hg.currentY;
      groupRef.current.rotation.x = hg.currentX;
    }
    // Jaw animation
    if (jawRef.current) {
      const sp = speaking.current;
      const exprJaw = mouthExpr.current.currentOffsets;
      if (sp.active) {
        if (t > sp.nextSyllableAt) {
          const openness = 0.02 + Math.random() * 0.18;
          sp.targetAngle = openness;
          sp.targetDrop = openness * 1.2;
          sp.nextSyllableAt = t + 0.06 + Math.random() * 0.14;
        }
        sp.currentAngle = damp(sp.currentAngle, sp.targetAngle, 22, d);
        sp.currentDrop = damp(sp.currentDrop, sp.targetDrop, 22, d);
        jawRef.current.rotation.x = sp.currentAngle + exprJaw.jawOpen;
        jawRef.current.position.y = -0.3 - sp.currentDrop - exprJaw.jawDrop;
      } else {
        const idleAngle = Math.sin(t * 0.8) * 0.03;
        sp.currentAngle = damp(sp.currentAngle, idleAngle, 6, d);
        sp.currentDrop = damp(sp.currentDrop, 0, 6, d);
        jawRef.current.rotation.x = sp.currentAngle + exprJaw.jawOpen;
        jawRef.current.position.y = -0.3 - sp.currentDrop - exprJaw.jawDrop;
      }
    }
    // Eye glow animation
    const eg = eyeGlow.current;
    if (eg.phase !== "off") {
      if (eg.phase === "ramp") {
        eg.intensity = damp(eg.intensity, 1.0, 8, d);
        if (eg.intensity > 0.95) {
          eg.intensity = 1.0;
          eg.phase = "hold";
          eg.nextFlickerAt = t;
        }
      } else if (eg.phase === "hold") {
        if (t > eg.nextFlickerAt) {
          eg.flickerTarget = 0.5 + Math.random() * 0.5;
          eg.nextFlickerAt = t + 0.04 + Math.random() * 0.12;
        }
        eg.intensity = damp(eg.intensity, eg.flickerTarget, 22, d);
      } else if (eg.phase === "fade") {
        eg.intensity = damp(eg.intensity, 0, 4, d);
        if (eg.intensity < 0.005) {
          eg.intensity = 0;
          eg.phase = "off";
        }
      }

      const color = new THREE.Color(1, 0.3, 0.1).multiplyScalar(12);

      if (leftEyeMatRef.current) {
        leftEyeMatRef.current.color.copy(color);
        leftEyeMatRef.current.opacity = eg.intensity;
      }
      if (rightEyeMatRef.current) {
        rightEyeMatRef.current.color.copy(color);
        rightEyeMatRef.current.opacity = eg.intensity;
      }
    }

    // Vertex glitch + spikes
    glitchUpper(t);
    glitchJaw(t);

    // Expression animation — lerp all offsets toward target expression
    {
      const me = mouthExpr.current;
      const target = EXPRESSION_OFFSETS[me.target];
      const co = me.currentOffsets;
      const speed = 8;

      for (const key of Object.keys(co) as (keyof ExpressionOffsets)[]) {
        (co as any)[key] = damp(co[key], target[key], speed, d);
      }

      // --- Upper face ---
      const upperPos = upper.geo.getAttribute("position") as THREE.BufferAttribute;
      const up = upperPos.array as Float32Array;
      const ub = upperExprBase;

      // 17: left cheek
      up[17 * 3 + 1] = ub.v17.y + co.cheekDY;
      // 18: right cheek
      up[18 * 3 + 1] = ub.v18.y + co.cheekDY;
      // 19: left mouth corner
      up[19 * 3]     = ub.v19.x - co.cornerDX;
      up[19 * 3 + 1] = ub.v19.y + co.cornerDY;
      // 20: right mouth corner
      up[20 * 3]     = ub.v20.x + co.cornerDX;
      up[20 * 3 + 1] = ub.v20.y + co.cornerDY;
      // 21: upper lip center
      up[21 * 3 + 1] = ub.v21.y + co.lipDY;
      up[21 * 3 + 2] = ub.v21.z + co.lipDZ;
      // 22: left jaw hinge
      up[22 * 3 + 1] = ub.v22.y + co.hingeDY;
      // 23: right jaw hinge
      up[23 * 3 + 1] = ub.v23.y + co.hingeDY;

      upperPos.needsUpdate = true;
      upper.geo.computeVertexNormals();

      // --- Jaw ---
      const jawPos = jaw.geo.getAttribute("position") as THREE.BufferAttribute;
      const jp = jawPos.array as Float32Array;
      const jb = jawExprBase;

      // 0: left hinge
      jp[0 * 3 + 1] = jb.v0.y + co.hingeDY;
      // 1: right hinge
      jp[1 * 3 + 1] = jb.v1.y + co.hingeDY;
      // 2: left mouth corner
      jp[2 * 3]     = jb.v2.x - co.cornerDX;
      jp[2 * 3 + 1] = jb.v2.y + co.jawCornerDY;
      // 3: right mouth corner
      jp[3 * 3]     = jb.v3.x + co.cornerDX;
      jp[3 * 3 + 1] = jb.v3.y + co.jawCornerDY;
      // 4: lower lip center
      jp[4 * 3 + 1] = jb.v4.y + co.jawLipDY;
      jp[4 * 3 + 2] = jb.v4.z + co.jawLipDZ;

      jawPos.needsUpdate = true;
      jaw.geo.computeVertexNormals();
    }

    // Env map spin — per-material rotation for permission-waiting effect
    // Three.js only uses material.envMapRotation when material.envMap is set
    // (otherwise it falls back to scene.environmentRotation). So we must
    // explicitly assign the scene's environment texture to each material.
    // We spin relative to the scene's base environmentRotation so releasing
    // the envMap at the end is seamless (no visible snap).
    // Intensity fades down when spinning starts and back up before releasing.
    {
      const es = envSpin.current;

      if (es.active) {
        // Capture scene's base rotation and intensity when we first acquire the envMap
        const needsEnvMap = !upperMatRef.current?.envMap;
        if (needsEnvMap && scene.environment) {
          es.baseX = scene.environmentRotation.x;
          es.baseY = scene.environmentRotation.y;
          es.baseZ = scene.environmentRotation.z;
          es.sceneIntensity = scene.environmentIntensity;
          es.intensity = es.sceneIntensity;
        }

        if (es.targetSpeed > 0) {
          // Spinning: accelerate toward target speed, dim intensity
          es.speed = damp(es.speed, es.targetSpeed, 6, d);
          es.angle += es.speed * d;
          es.intensity = damp(es.intensity, ENV_SPIN_INTENSITY, 4, d);
        } else {
          // Stopping: decelerate, fade intensity back up, return angle to 0
          es.intensity = damp(es.intensity, es.sceneIntensity, 3, d);
          es.speed = damp(es.speed, 0, 6, d);

          if (Math.abs(es.speed) < 0.05) {
            es.speed = 0;
            // Normalize to [-π, π] for shortest return path
            es.angle = es.angle % (Math.PI * 2);
            if (es.angle > Math.PI) es.angle -= Math.PI * 2;
            if (es.angle < -Math.PI) es.angle += Math.PI * 2;
            es.angle = damp(es.angle, 0, 1.5, d);

            // Once angle AND intensity are back to origin, release envMap seamlessly
            const angleSettled = Math.abs(es.angle) < 0.002;
            const intensitySettled = Math.abs(es.intensity - es.sceneIntensity) < 0.02;
            if (angleSettled && intensitySettled) {
              es.angle = 0;
              es.intensity = es.sceneIntensity;
              if (upperMatRef.current) {
                upperMatRef.current.envMapIntensity = 1.2;
                upperMatRef.current.envMap = null;
                upperMatRef.current.needsUpdate = true;
              }
              if (jawMatRef.current) {
                jawMatRef.current.envMapIntensity = 1.2;
                jawMatRef.current.envMap = null;
                jawMatRef.current.needsUpdate = true;
              }
              es.active = false;
            }
          } else {
            es.angle += es.speed * d;
          }
        }

        // Apply rotation and intensity to materials
        if (es.active) {
          const rot = new THREE.Euler(es.baseX, es.baseY + es.angle, es.baseZ);
          if (upperMatRef.current) {
            if (!upperMatRef.current.envMap && scene.environment) {
              upperMatRef.current.envMap = scene.environment;
            }
            upperMatRef.current.envMapRotation.copy(rot);
            upperMatRef.current.envMapIntensity = es.intensity;
            upperMatRef.current.needsUpdate = true;
          }
          if (jawMatRef.current) {
            if (!jawMatRef.current.envMap && scene.environment) {
              jawMatRef.current.envMap = scene.environment;
            }
            jawMatRef.current.envMapRotation.copy(rot);
            jawMatRef.current.envMapIntensity = es.intensity;
            jawMatRef.current.needsUpdate = true;
          }
        }
      }
    }
  });

  const materialProps = {
    color: color ?? "#cc1111",
    flatShading: true,
    roughness: 0.15,
    metalness: 0.95,
    reflectivity: 1.0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
    envMapIntensity: 1.2,
    side: THREE.DoubleSide,
  } as const;

  return (
    <group ref={groupRef}>
      {/* Eye glow diamonds — sit just behind the eye holes */}
      <mesh geometry={leftEyeGeo}>
        <meshBasicMaterial
          ref={leftEyeMatRef}
          color={[1, 0.3, 0.1]}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh geometry={rightEyeGeo}>
        <meshBasicMaterial
          ref={rightEyeMatRef}
          color={[1, 0.3, 0.1]}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Upper face */}
      <mesh geometry={upper.geo}>
        <meshPhysicalMaterial ref={upperMatRef} {...materialProps} />
      </mesh>

      {/* Jaw — pivots at y=-0.3 (the mouth line) */}
      <group ref={jawRef} position={[0, -0.3, 0]}>
        <mesh geometry={jaw.geo}>
          <meshPhysicalMaterial ref={jawMatRef} {...materialProps} />
        </mesh>
      </group>
    </group>
  );
});
