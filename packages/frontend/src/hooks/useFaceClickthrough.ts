/**
 * Handles face click detection for the overlay mode.
 *
 * The Tauri overlay toggles click-through on/off based on cursor position
 * (hit testing happens in Rust). When click-through is off, the webview
 * receives mouse events. This hook detects clicks on face positions and
 * triggers the onFaceClick callback, and tracks hover state.
 */

import { useEffect, useRef, useCallback } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

type FaceTarget = {
  agentId: string;
  /** World position of the face group */
  worldPos: THREE.Vector3;
};

/** Screen-space hit radius in CSS pixels — generous to account for bobbing */
const HIT_RADIUS = 55;

export function useFaceClickthrough(
  onFaceClick: (agentId: string) => void,
  onHoverChange?: (agentId: string | null) => void,
) {
  const { camera, gl, size } = useThree();
  const facesRef = useRef<FaceTarget[]>([]);
  const hoveredRef = useRef<string | null>(null);

  /** Update the list of face positions each frame (called by parent) */
  const updateFaceTargets = useCallback((targets: FaceTarget[]) => {
    facesRef.current = targets;
  }, []);

  /** Project a world position to screen CSS pixels (top-left origin) */
  const worldToScreen = useCallback(
    (worldPos: THREE.Vector3): { x: number; y: number } => {
      const ndc = worldPos.clone().project(camera);
      return {
        x: ((ndc.x + 1) / 2) * size.width,
        y: ((1 - ndc.y) / 2) * size.height,
      };
    },
    [camera, size],
  );

  /** Find which face (if any) the cursor is over */
  const hitTest = useCallback(
    (cursorX: number, cursorY: number): string | null => {
      let closest: string | null = null;
      let closestDist = Infinity;
      for (const face of facesRef.current) {
        const screen = worldToScreen(face.worldPos);
        const dx = cursorX - screen.x;
        const dy = cursorY - screen.y;
        const dist = dx * dx + dy * dy;
        if (dist <= HIT_RADIUS * HIT_RADIUS && dist < closestDist) {
          closest = face.agentId;
          closestDist = dist;
        }
      }
      return closest;
    },
    [worldToScreen],
  );

  const setHovered = useCallback(
    (agentId: string | null) => {
      if (hoveredRef.current !== agentId) {
        hoveredRef.current = agentId;
        onHoverChange?.(agentId);
      }
    },
    [onHoverChange],
  );

  // When the overlay disables click-through (cursor is over a face),
  // the webview receives mouse events. Handle clicks and cursor style.
  useEffect(() => {
    const canvas = gl.domElement;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTest(x, y);
      canvas.style.cursor = hit ? "pointer" : "";
      setHovered(hit);
    };

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTest(x, y);
      if (hit) {
        onFaceClick(hit);
      }
    };

    const onMouseLeave = () => {
      canvas.style.cursor = "";
      setHovered(null);
    };

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mouseleave", onMouseLeave);

    return () => {
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [gl, hitTest, setHovered, onFaceClick]);

  return { updateFaceTargets };
}
