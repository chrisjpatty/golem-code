import { useRef, useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { GolemScene } from "./GolemScene";
import { GolemFace, type GolemFaceHandle } from "./GolemFace";
import type { ReactNode } from "react";

const URL_PARAMS = new URLSearchParams(window.location.search);
const SEED = Number(URL_PARAMS.get("seed") ?? Math.floor(Math.random() * 1_000_000));
const COLOR = URL_PARAMS.get("color") ?? "#cc1111";

const FACE_SCALE = 0.18;

function SnapshotAnchor({ children }: { children: ReactNode }) {
  const { viewport } = useThree();
  const padX = 0.45;
  const padY = 0.55;
  return (
    <group position={[viewport.width / 2 - padX, -viewport.height / 2 + padY, 0]}>
      {children}
    </group>
  );
}

function SnapshotFace() {
  const faceRef = useRef<GolemFaceHandle>(null);

  useEffect(() => {
    // Turn eyes on immediately so the snapshot has glowing eyes
    faceRef.current?.startEyeGlow();

    // Signal readiness after a few frames for the screenshot tool to pick up
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      if (frame >= 10) {
        clearInterval(id);
        (window as any).__SNAPSHOT_READY__ = true;
      }
    }, 16);
    return () => clearInterval(id);
  }, []);

  return (
    <group scale={[FACE_SCALE, FACE_SCALE, FACE_SCALE]}>
      <GolemFace ref={faceRef} seed={SEED} color={COLOR} />
    </group>
  );
}

export function SnapshotApp() {
  return (
    <GolemScene mode="overlay">
      <SnapshotAnchor>
        <SnapshotFace />
      </SnapshotAnchor>
    </GolemScene>
  );
}
