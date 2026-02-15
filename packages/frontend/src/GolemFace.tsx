import { useRef, useMemo, useCallback, useImperativeHandle, forwardRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type GolemFaceHandle = {
  startSpeaking: () => void;
  stopSpeaking: () => void;
  startEyeGlow: () => void;
  stopEyeGlow: () => void;
};

// Eye fill geometry — exact match to the socket hole vertices, pushed forward
function createLeftEyeGeometry(): THREE.BufferGeometry {
  // Matches: 5=top, 6=outer, 7=bottom, 8=inner (from upper face)
  const verts = new Float32Array([
    -0.75, 1.2, 0.05,   // top
    -1.1,  0.85, -0.05, // outer
    -0.75, 0.5, 0.05,   // bottom
    -0.4,  0.85, 0.1,   // inner
  ]);
  const indices = [0, 1, 2, 0, 2, 3];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createRightEyeGeometry(): THREE.BufferGeometry {
  // Matches: 9=top, 10=outer, 11=bottom, 12=inner (from upper face)
  const verts = new Float32Array([
    0.75, 1.2, 0.05,    // top
    1.1,  0.85, -0.05,  // outer
    0.75, 0.5, 0.05,    // bottom
    0.4,  0.85, 0.1,    // inner
  ]);
  const indices = [0, 3, 2, 0, 2, 1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

type EyeGlowPhase = "off" | "ramp" | "hold" | "fade";

/**
 * Low-poly golem face with diamond eye holes and a hinged jaw.
 *
 * The face is built from manually defined vertices and triangles.
 * The upper face (including eye sockets) is one mesh.
 * The jaw is a separate mesh that pivots at the jaw hinge.
 */

// -- Upper face geometry (forehead, cheeks, nose, eye sockets) --

function createUpperFaceGeometry(): GlitchGeo {
  // Vertices: [x, y, z]
  // The face is roughly 3 units wide, 4 units tall, centered at origin.
  // Eye sockets are diamond-shaped holes.
  const verts: [number, number, number][] = [
    // 0: top center (forehead peak)
    [0, 2.0, 0.0],
    // 1: top left
    [-1.0, 1.8, -0.1],
    // 2: top right
    [1.0, 1.8, -0.1],
    // 3: far left temple
    [-1.5, 1.0, -0.3],
    // 4: far right temple
    [1.5, 1.0, -0.3],

    // Left eye diamond: 5=top, 6=left, 7=bottom, 8=right
    // 5: left eye top
    [-0.75, 1.2, 0.15],
    // 6: left eye outer
    [-1.1, 0.85, 0.05],
    // 7: left eye bottom
    [-0.75, 0.5, 0.15],
    // 8: left eye inner
    [-0.4, 0.85, 0.2],

    // Right eye diamond: 9=top, 10=right, 11=bottom, 12=left
    // 9: right eye top
    [0.75, 1.2, 0.15],
    // 10: right eye outer
    [1.1, 0.85, 0.05],
    // 11: right eye bottom
    [0.75, 0.5, 0.15],
    // 12: right eye inner
    [0.4, 0.85, 0.2],

    // 13: nose bridge (between eyes, high)
    [0, 1.0, 0.35],
    // 14: nose tip
    [0, 0.4, 0.5],
    // 15: nose left
    [-0.25, 0.2, 0.35],
    // 16: nose right
    [0.25, 0.2, 0.35],

    // 17: left cheek
    [-1.3, 0.0, -0.15],
    // 18: right cheek
    [1.3, 0.0, -0.15],

    // Mouth line / jaw hinge vertices (the split line between upper and lower face)
    // 19: mouth left corner
    [-0.7, -0.2, 0.15],
    // 20: mouth right corner
    [0.7, -0.2, 0.15],
    // 21: upper lip center
    [0, -0.1, 0.3],

    // 22: left jaw hinge
    [-1.4, -0.3, -0.25],
    // 23: right jaw hinge
    [1.4, -0.3, -0.25],
  ];

  // Triangles (indices into verts) — winding order for front face (CCW)
  const faces: [number, number, number][] = [
    // Forehead
    [0, 1, 5],
    [0, 5, 13],
    [0, 13, 9],
    [0, 9, 2],
    [1, 3, 6],
    [1, 6, 5],
    [2, 9, 10],
    [2, 10, 4],

    // Between eyes (bridge)
    [5, 8, 13],
    [13, 12, 9],

    // Left eye surround → below eye
    [3, 17, 7],
    [3, 7, 6],
    [7, 17, 19],
    [7, 19, 15],
    [7, 15, 14],
    [7, 14, 8],
    [8, 14, 13],

    // Right eye surround → below eye
    [4, 10, 11],
    [4, 11, 18],
    [11, 16, 14],
    [11, 14, 12],
    [12, 14, 13],
    [11, 20, 16],
    [11, 18, 20],

    // Nose
    [14, 15, 21],
    [14, 21, 16],

    // Upper lip / mouth area
    [15, 19, 21],
    [16, 21, 20],

    // Cheek to jaw hinge
    [17, 22, 19],
    [18, 20, 23],
  ];

  return buildGlitchGeo(verts, faces);
}

// -- Jaw geometry --

function createJawGeometry(): GlitchGeo {
  // The jaw is a separate piece that hangs below the mouth line.
  // It pivots at roughly y=-0.3.
  // These coordinates are relative — the jaw group will be positioned at the hinge point.
  const verts: [number, number, number][] = [
    // 0: left hinge
    [-1.4, 0, -0.25],
    // 1: right hinge
    [1.4, 0, -0.25],
    // 2: left mouth corner
    [-0.7, 0, 0.3],
    // 3: right mouth corner
    [0.7, 0, 0.3],
    // 4: lower lip center
    [0, 0.05, 0.5],

    // 5: chin center
    [0, -1.0, 0.4],
    // 6: chin left
    [-0.8, -0.8, 0.25],
    // 7: chin right
    [0.8, -0.8, 0.25],

    // 8: jaw left
    [-1.2, -0.5, 0.0],
    // 9: jaw right
    [1.2, -0.5, 0.0],

    // 10: chin bottom
    [0, -1.2, 0.15],
  ];

  const faces: [number, number, number][] = [
    // Lower lip
    [2, 4, 6],
    [4, 5, 6],
    [4, 3, 7],
    [4, 7, 5],

    // Jaw sides
    [0, 2, 6],
    [0, 6, 8],
    [3, 1, 9],
    [3, 9, 7],

    // Under jaw
    [8, 6, 5],
    [8, 5, 10],
    [9, 10, 5],
    [9, 5, 7],
    [0, 8, 10],
    [0, 10, 1],
    [1, 10, 9],
  ];

  return buildGlitchGeo(verts, faces);
}

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

export const GolemFace = forwardRef<GolemFaceHandle>(function GolemFace(_, ref) {
  const groupRef = useRef<THREE.Group>(null);
  const jawRef = useRef<THREE.Group>(null);

  const upper = useMemo(() => createUpperFaceGeometry(), []);
  const jaw = useMemo(() => createJawGeometry(), []);

  const glitchUpper = useVertexGlitch(upper);
  const glitchJaw = useVertexGlitch(jaw);

  // Eye glow
  const leftEyeGeo = useMemo(() => createLeftEyeGeometry(), []);
  const rightEyeGeo = useMemo(() => createRightEyeGeometry(), []);
  const leftEyeMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const rightEyeMatRef = useRef<THREE.MeshBasicMaterial>(null);

  const eyeGlow = useRef({
    phase: "off" as EyeGlowPhase,
    intensity: 0,
    nextFlickerAt: 0,
    flickerTarget: 1.0,
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
  }));

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    // Slow head bob
    if (groupRef.current) {
      groupRef.current.position.y = Math.sin(t * 0.5) * 0.12;
    }
    // Jaw animation
    if (jawRef.current) {
      const sp = speaking.current;
      if (sp.active) {
        // Pick new syllable targets at irregular intervals
        if (t > sp.nextSyllableAt) {
          const openness = 0.02 + Math.random() * 0.18;
          sp.targetAngle = openness;
          sp.targetDrop = openness * 1.2; // drop proportional to opening
          sp.nextSyllableAt = t + 0.06 + Math.random() * 0.14;
        }
        // Lerp toward targets for smooth motion
        sp.currentAngle += (sp.targetAngle - sp.currentAngle) * 0.3;
        sp.currentDrop += (sp.targetDrop - sp.currentDrop) * 0.3;
        jawRef.current.rotation.x = sp.currentAngle;
        jawRef.current.position.y = -0.3 - sp.currentDrop;
      } else {
        // Ease back to idle breathing
        const idleAngle = Math.sin(t * 0.8) * 0.03;
        sp.currentAngle += (idleAngle - sp.currentAngle) * 0.1;
        sp.currentDrop += (0 - sp.currentDrop) * 0.1;
        jawRef.current.rotation.x = sp.currentAngle;
        jawRef.current.position.y = -0.3 - sp.currentDrop;
      }
    }
    // Eye glow animation
    const eg = eyeGlow.current;
    if (eg.phase !== "off") {
      if (eg.phase === "ramp") {
        // Fade in (3x faster than fade out)
        eg.intensity += (1.0 - eg.intensity) * 0.12;
        if (eg.intensity > 0.95) {
          eg.intensity = 1.0;
          eg.phase = "hold";
          eg.nextFlickerAt = t;
        }
      } else if (eg.phase === "hold") {
        // Subtle flicker while holding
        if (t > eg.nextFlickerAt) {
          eg.flickerTarget = 0.5 + Math.random() * 0.5;
          eg.nextFlickerAt = t + 0.04 + Math.random() * 0.12;
        }
        eg.intensity += (eg.flickerTarget - eg.intensity) * 0.3;
      } else if (eg.phase === "fade") {
        eg.intensity += (0 - eg.intensity) * 0.06;
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
      color="#cc1111"
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
