import * as THREE from "three";

// --- Seeded PRNG (mulberry32) ---

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(min: number, max: number, t: number): number {
  return min + (max - min) * t;
}

// --- Types ---

export type FaceParams = {
  foreheadHeight: number;
  foreheadWidth: number;
  templeWidth: number;
  templeDepth: number;
  eyeScale: number;
  eyeSpacing: number;
  eyeHeight: number;
  eyeTilt: number;
  noseLength: number;
  noseWidth: number;
  noseProtrusion: number;
  cheekWidth: number;
  jawWidth: number;
  chinLength: number;
  chinWidth: number;
  chinProtrusion: number;
  mouthWidth: number;
  upperLipCurve: number;
  upperLipFullness: number;
  lowerLipFullness: number;
  hornCount: 0 | 1 | 2;
  hornLength: number;
  hornBaseWidth: number;
  hornAngle: number;
  hornForwardTilt: number;
  hasEars: boolean;
  earSize: number;
  earAngle: number;
  earPointiness: number;
};

export type FaceGeometryData = {
  verts: [number, number, number][];
  faces: [number, number, number][];
};

// --- Default params (matches current hardcoded geometry exactly) ---

export const DEFAULT_FACE_PARAMS: FaceParams = {
  foreheadHeight: 2.0,
  foreheadWidth: 1.0,
  templeWidth: 1.5,
  templeDepth: -0.3,
  eyeScale: 1.0,
  eyeSpacing: 0.75,
  eyeHeight: 0.85,
  eyeTilt: 0.0,
  noseLength: 0.4,
  noseWidth: 0.25,
  noseProtrusion: 0.5,
  cheekWidth: 1.3,
  jawWidth: 1.4,
  chinLength: 1.0,
  chinWidth: 0.8,
  chinProtrusion: 0.4,
  mouthWidth: 0.7,
  upperLipCurve: 0,
  upperLipFullness: 0.3,
  lowerLipFullness: 1.0,
  hornCount: 0,
  hornLength: 0.8,
  hornBaseWidth: 0.2,
  hornAngle: 0.4,
  hornForwardTilt: 0.0,
  hasEars: false,
  earSize: 0.5,
  earAngle: 0.3,
  earPointiness: 0.5,
};

// --- Param generation from seed ---

export function generateFaceParams(seed: number): FaceParams {
  const rand = mulberry32(seed);
  const hornRoll = rand();
  const hornCount = (hornRoll < 0.3 ? (rand() < 0.5 ? 1 : 2) : 0) as 0 | 1 | 2;

  return {
    foreheadHeight: lerp(1.7, 2.3, rand()),
    foreheadWidth: lerp(0.7, 1.3, rand()),
    templeWidth: lerp(1.2, 1.8, rand()),
    templeDepth: lerp(-0.5, -0.1, rand()),
    eyeScale: lerp(0.7, 1.3, rand()),
    eyeSpacing: lerp(0.55, 0.95, rand()),
    eyeHeight: lerp(0.7, 1.0, rand()),
    eyeTilt: lerp(-0.15, 0.15, rand()),
    noseLength: lerp(0.2, 0.6, rand()),
    noseWidth: lerp(0.15, 0.35, rand()),
    noseProtrusion: lerp(0.35, 0.65, rand()),
    cheekWidth: lerp(1.0, 1.6, rand()),
    jawWidth: lerp(1.1, 1.7, rand()),
    chinLength: lerp(0.7, 1.3, rand()),
    chinWidth: lerp(0.5, 1.1, rand()),
    chinProtrusion: lerp(0.2, 0.6, rand()),
    mouthWidth: lerp(0.5, 0.9, rand()),
    upperLipCurve: lerp(-0.1, 0.1, rand()),
    upperLipFullness: lerp(0.2, 0.4, rand()),
    lowerLipFullness: lerp(0.8, 1.2, rand()),
    hornCount,
    hornLength: lerp(0.4, 1.5, rand()),
    hornBaseWidth: lerp(0.1, 0.35, rand()),
    hornAngle: lerp(0.1, 0.8, rand()),
    hornForwardTilt: lerp(-0.3, 0.3, rand()),
    hasEars: rand() < 0.4,
    earSize: lerp(0.3, 0.8, rand()),
    earAngle: lerp(0.1, 0.5, rand()),
    earPointiness: lerp(0.2, 0.9, rand()),
  };
}

// --- Eye offset computation (shared between socket and fill) ---

function computeEyeOffsets(p: FaceParams) {
  const eyeHalfH = 0.35 * p.eyeScale;
  const eyeHalfW = 0.35 * p.eyeScale;
  const cos = Math.cos(p.eyeTilt);
  const sin = Math.sin(p.eyeTilt);
  return {
    topDX: -eyeHalfH * sin,
    topDY: eyeHalfH * cos,
    outerDX: -eyeHalfW * cos,
    outerDY: -eyeHalfW * sin,
    bottomDX: eyeHalfH * sin,
    bottomDY: -eyeHalfH * cos,
    innerDX: eyeHalfW * cos,
    innerDY: eyeHalfW * sin,
  };
}

// --- Horn generation ---

function appendHorns(
  verts: [number, number, number][],
  faces: [number, number, number][],
  p: FaceParams
) {
  const positions: { x: number; side: number }[] = [];
  if (p.hornCount === 1) {
    positions.push({ x: 0, side: 0 });
  } else if (p.hornCount === 2) {
    positions.push({ x: -p.foreheadWidth * 0.6, side: -1 });
    positions.push({ x: p.foreheadWidth * 0.6, side: 1 });
  }

  for (const hp of positions) {
    const baseIdx = verts.length;
    const baseX = hp.x;
    const baseY = p.foreheadHeight - 0.1;
    const baseZ = -0.05;

    // Horn direction
    let dx: number, dy: number, dz: number;
    if (hp.side === 0) {
      // Center horn: straight up with forward tilt
      dx = 0;
      dy = Math.cos(Math.abs(p.hornForwardTilt));
      dz = -Math.sin(p.hornForwardTilt);
    } else {
      // Side horns: lean outward by hornAngle
      dx = Math.sin(p.hornAngle) * hp.side;
      dy = Math.cos(p.hornAngle);
      dz = -Math.sin(p.hornForwardTilt);
    }
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const tipX = baseX + (dx / len) * p.hornLength;
    const tipY = baseY + (dy / len) * p.hornLength;
    const tipZ = baseZ + (dz / len) * p.hornLength;

    const w = p.hornBaseWidth;
    verts.push(
      [baseX - w, baseY, baseZ - w * 0.5],
      [baseX + w, baseY, baseZ - w * 0.5],
      [baseX, baseY - w * 0.3, baseZ + w],
      [tipX, tipY, tipZ]
    );

    // 4 faces: 3 side faces + base cap
    faces.push(
      [baseIdx, baseIdx + 1, baseIdx + 3],
      [baseIdx + 1, baseIdx + 2, baseIdx + 3],
      [baseIdx + 2, baseIdx, baseIdx + 3],
      [baseIdx, baseIdx + 2, baseIdx + 1]
    );
  }
}

// --- Ear generation ---

function appendEars(
  verts: [number, number, number][],
  faces: [number, number, number][],
  p: FaceParams
) {
  const templeY = p.eyeHeight + 0.15;

  for (const side of [-1, 1] as const) {
    const baseIdx = verts.length;
    const templeX = side * p.templeWidth;
    const templeZ = p.templeDepth;

    const earWidth = p.earSize * 0.6;
    const earHeight = p.earSize;
    const earOut = p.earAngle;

    verts.push(
      // Base top (on face surface)
      [templeX, templeY + earHeight * 0.3, templeZ],
      // Base bottom (on face surface)
      [templeX, templeY - earHeight * 0.3, templeZ],
      // Ear tip (pointed, sticking out)
      [
        templeX + side * earWidth,
        templeY + earHeight * p.earPointiness * 0.5,
        templeZ - earOut,
      ],
      // Ear lobe (bottom outer)
      [
        templeX + side * earWidth * 0.7,
        templeY - earHeight * 0.5,
        templeZ - earOut * 0.7,
      ]
    );

    // 2 triangles forming the ear fin
    if (side === -1) {
      faces.push(
        [baseIdx, baseIdx + 2, baseIdx + 1],
        [baseIdx + 1, baseIdx + 2, baseIdx + 3]
      );
    } else {
      faces.push(
        [baseIdx, baseIdx + 1, baseIdx + 2],
        [baseIdx + 1, baseIdx + 3, baseIdx + 2]
      );
    }
  }
}

// --- Upper face geometry ---

export function createUpperFaceGeometry(p: FaceParams): FaceGeometryData {
  const eyeCZ = 0.1;
  const e = computeEyeOffsets(p);

  const noseBridgeY = p.eyeHeight + 0.15;
  const noseTipY = noseBridgeY - 1.5 * p.noseLength;
  const noseLRY = noseTipY - 0.2;

  const verts: [number, number, number][] = [
    // 0: top center (forehead peak)
    [0, p.foreheadHeight, 0.0],
    // 1: top left
    [-p.foreheadWidth, p.foreheadHeight - 0.2, -0.1],
    // 2: top right
    [p.foreheadWidth, p.foreheadHeight - 0.2, -0.1],
    // 3: far left temple
    [-p.templeWidth, p.eyeHeight + 0.15, p.templeDepth],
    // 4: far right temple
    [p.templeWidth, p.eyeHeight + 0.15, p.templeDepth],

    // Left eye diamond: 5=top, 6=outer, 7=bottom, 8=inner
    [-p.eyeSpacing + e.topDX, p.eyeHeight + e.topDY, eyeCZ + 0.05],
    [-p.eyeSpacing + e.outerDX, p.eyeHeight + e.outerDY, eyeCZ - 0.05],
    [-p.eyeSpacing + e.bottomDX, p.eyeHeight + e.bottomDY, eyeCZ + 0.05],
    [-p.eyeSpacing + e.innerDX, p.eyeHeight + e.innerDY, eyeCZ + 0.1],

    // Right eye diamond: 9=top, 10=outer, 11=bottom, 12=inner
    [p.eyeSpacing - e.topDX, p.eyeHeight + e.topDY, eyeCZ + 0.05],
    [p.eyeSpacing - e.outerDX, p.eyeHeight + e.outerDY, eyeCZ - 0.05],
    [p.eyeSpacing - e.bottomDX, p.eyeHeight + e.bottomDY, eyeCZ + 0.05],
    [p.eyeSpacing - e.innerDX, p.eyeHeight + e.innerDY, eyeCZ + 0.1],

    // 13: nose bridge
    [0, noseBridgeY, p.noseProtrusion * 0.7],
    // 14: nose tip
    [0, noseTipY, p.noseProtrusion],
    // 15: nose left
    [-p.noseWidth, noseLRY, p.noseProtrusion * 0.7],
    // 16: nose right
    [p.noseWidth, noseLRY, p.noseProtrusion * 0.7],

    // 17: left cheek
    [-p.cheekWidth, 0.0, -0.15],
    // 18: right cheek
    [p.cheekWidth, 0.0, -0.15],

    // 19: mouth left corner
    [-p.mouthWidth, -0.2 + p.upperLipCurve, 0.15],
    // 20: mouth right corner
    [p.mouthWidth, -0.2 + p.upperLipCurve, 0.15],
    // 21: upper lip center
    [0, -0.1, p.upperLipFullness],

    // 22: left jaw hinge
    [-p.jawWidth, -0.3, -0.25],
    // 23: right jaw hinge
    [p.jawWidth, -0.3, -0.25],
  ];

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

  if (p.hornCount > 0) {
    appendHorns(verts, faces, p);
  }
  if (p.hasEars) {
    appendEars(verts, faces, p);
  }

  return { verts, faces };
}

// --- Jaw geometry ---

export function createJawGeometry(p: FaceParams): FaceGeometryData {
  const verts: [number, number, number][] = [
    // 0: left hinge
    [-p.jawWidth, -0.08, -0.25],
    // 1: right hinge
    [p.jawWidth, -0.08, -0.25],
    // 2: left mouth corner
    [-p.mouthWidth, 0, 0.3],
    // 3: right mouth corner
    [p.mouthWidth, 0, 0.3],
    // 4: lower lip center
    [0, 0.05, p.noseProtrusion * p.lowerLipFullness],

    // 5: chin center
    [0, -p.chinLength, p.chinProtrusion],
    // 6: chin left
    [-p.chinWidth, -p.chinLength * 0.8, (p.chinProtrusion * 5) / 8],
    // 7: chin right
    [p.chinWidth, -p.chinLength * 0.8, (p.chinProtrusion * 5) / 8],

    // 8: jaw left
    [(-p.jawWidth * 6) / 7, -p.chinLength * 0.5, 0.0],
    // 9: jaw right
    [(p.jawWidth * 6) / 7, -p.chinLength * 0.5, 0.0],

    // 10: chin bottom
    [0, -p.chinLength * 1.2, (p.chinProtrusion * 3) / 8],
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

  return { verts, faces };
}

// --- Eye fill geometries ---

export function createLeftEyeGeometry(p: FaceParams): THREE.BufferGeometry {
  const eyeCZ = 0.1;
  const e = computeEyeOffsets(p);

  // Eye fill sits 0.1 behind the socket in Z
  const verts = new Float32Array([
    -p.eyeSpacing + e.topDX,
    p.eyeHeight + e.topDY,
    eyeCZ - 0.05,
    -p.eyeSpacing + e.outerDX,
    p.eyeHeight + e.outerDY,
    eyeCZ - 0.15,
    -p.eyeSpacing + e.bottomDX,
    p.eyeHeight + e.bottomDY,
    eyeCZ - 0.05,
    -p.eyeSpacing + e.innerDX,
    p.eyeHeight + e.innerDY,
    eyeCZ,
  ]);

  const indices = [0, 1, 2, 0, 2, 3];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function createRightEyeGeometry(p: FaceParams): THREE.BufferGeometry {
  const eyeCZ = 0.1;
  const e = computeEyeOffsets(p);

  const verts = new Float32Array([
    p.eyeSpacing - e.topDX,
    p.eyeHeight + e.topDY,
    eyeCZ - 0.05,
    p.eyeSpacing - e.outerDX,
    p.eyeHeight + e.outerDY,
    eyeCZ - 0.15,
    p.eyeSpacing - e.bottomDX,
    p.eyeHeight + e.bottomDY,
    eyeCZ - 0.05,
    p.eyeSpacing - e.innerDX,
    p.eyeHeight + e.innerDY,
    eyeCZ,
  ]);

  const indices = [0, 3, 2, 0, 2, 1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
