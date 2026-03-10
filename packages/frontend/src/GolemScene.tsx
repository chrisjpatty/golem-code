import type { ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import {
  EffectComposer,
  Pixelation,
  Noise,
  Vignette,
  Bloom,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";

export type SceneMode = "browser" | "overlay";

interface GolemSceneProps {
  mode?: SceneMode;
  children?: ReactNode;
}

const BROWSER_CONFIG = {
  background: "#1a0a0a" as const,
  fogNear: 8,
  fogFar: 20,
  zoom: 180,
} as const;

const OVERLAY_CONFIG = {
  zoom: 180,
} as const;

export function GolemScene({ mode = "browser", children }: GolemSceneProps) {
  const isOverlay = mode === "overlay";
  const zoom = isOverlay ? OVERLAY_CONFIG.zoom : BROWSER_CONFIG.zoom;

  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 5], zoom }}
      gl={{
        antialias: !isOverlay,
        toneMapping: 3 /* ACESFilmic */,
        alpha: isOverlay,
        premultipliedAlpha: !isOverlay,
      }}
      onCreated={({ gl }) => {
        if (isOverlay) {
          gl.setClearColor(0x000000, 0);
        }
      }}
    >
      {!isOverlay && (
        <>
          <color attach="background" args={[BROWSER_CONFIG.background]} />
          <fog
            attach="fog"
            args={[
              BROWSER_CONFIG.background,
              BROWSER_CONFIG.fogNear,
              BROWSER_CONFIG.fogFar,
            ]}
          />
        </>
      )}

      <Environment
        files="/studio_kominka_02_1k.hdr"
        background={false}
        environmentIntensity={3.0}
        environmentRotation={[
          (-15 * Math.PI) / 180,
          (-15 * Math.PI) / 180,
          0,
        ]}
      />
      <directionalLight position={[0, -2, 3]} intensity={4} color="#ff6644" />

      {children}

      {!isOverlay && <OrbitControls enablePan={false} />}

      <PostProcessing mode={mode} />
    </Canvas>
  );
}

function PostProcessing({ mode }: { mode: SceneMode }) {
  if (mode === "overlay") {
    // Noise and Vignette don't make sense without a background.
    // Bloom may destroy the alpha channel — start minimal and add back
    // effects incrementally once alpha compositing is verified.
    return (
      <EffectComposer multisampling={0}>
        <Pixelation granularity={6} />
        <Bloom
          luminanceThreshold={0.85}
          luminanceSmoothing={0.15}
          intensity={1.8}
          mipmapBlur
          radius={0.25}
          levels={3}
        />
      </EffectComposer>
    );
  }

  return (
    <EffectComposer>
      <Pixelation granularity={10} />
      <Bloom
        luminanceThreshold={0.3}
        luminanceSmoothing={0.9}
        intensity={0.8}
      />
      <Noise opacity={0.15} blendFunction={BlendFunction.OVERLAY} />
      <Vignette offset={0.3} darkness={0.7} />
    </EffectComposer>
  );
}
