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
  }));

  useFrame(({ clock }, delta) => {
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
      if (sp.active) {
        if (t > sp.nextSyllableAt) {
          const openness = 0.02 + Math.random() * 0.18;
          sp.targetAngle = openness;
          sp.targetDrop = openness * 1.2;
          sp.nextSyllableAt = t + 0.06 + Math.random() * 0.14;
        }
        sp.currentAngle = damp(sp.currentAngle, sp.targetAngle, 22, d);
        sp.currentDrop = damp(sp.currentDrop, sp.targetDrop, 22, d);
        jawRef.current.rotation.x = sp.currentAngle;
        jawRef.current.position.y = -0.3 - sp.currentDrop;
      } else {
        const idleAngle = Math.sin(t * 0.8) * 0.03;
        sp.currentAngle = damp(sp.currentAngle, idleAngle, 6, d);
        sp.currentDrop = damp(sp.currentDrop, 0, 6, d);
        jawRef.current.rotation.x = sp.currentAngle;
        jawRef.current.position.y = -0.3 - sp.currentDrop;
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
  });

  const material = (
    <meshPhysicalMaterial
      color={color ?? "#cc1111"}
      flatShading
      roughness={0.15}
      metalness={0.95}
      reflectivity={1.0}
      clearcoat={0.8}
      clearcoatRoughness={0.1}
      envMapIntensity={1.2}
      side={THREE.DoubleSide}
    />
  );

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
        {material}
      </mesh>

      {/* Jaw — pivots at y=-0.3 (the mouth line) */}
      <group ref={jawRef} position={[0, -0.3, 0]}>
        <mesh geometry={jaw.geo}>
          {material}
        </mesh>
      </group>
    </group>
  );
});
