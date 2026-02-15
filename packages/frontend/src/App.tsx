import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { EffectComposer, Pixelation, Noise, Vignette, Bloom } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { GolemFace, type GolemFaceHandle } from "./GolemFace";
import { DevPanel } from "./DevPanel";

export function App() {
  const faceRef = useRef<GolemFaceHandle>(null);

  return (
    <>
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        gl={{ antialias: true, toneMapping: 3 /* ACESFilmic */ }}
      >
        <color attach="background" args={["#1a0a0a"]} />
        <fog attach="fog" args={["#1a0a0a", 8, 20]} />
        <Environment files="/studio_kominka_02_1k.hdr" background={false} environmentIntensity={3.0} environmentRotation={[(-15 * Math.PI) / 180, (-15 * Math.PI) / 180, 0]} />
        <directionalLight position={[0, -2, 3]} intensity={4} color="#ff6644" />
        <GolemFace ref={faceRef} />
        <OrbitControls enablePan={false} />
        <EffectComposer>
          <Pixelation granularity={10} />
          <Bloom luminanceThreshold={0.3} luminanceSmoothing={0.9} intensity={0.8} />
          <Noise opacity={0.15} blendFunction={BlendFunction.OVERLAY} />
          <Vignette offset={0.3} darkness={0.7} />
        </EffectComposer>
      </Canvas>
      <DevPanel faceRef={faceRef} />
    </>
  );
}
