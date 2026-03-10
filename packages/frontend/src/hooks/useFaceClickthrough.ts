/**
 * Handles face click detection for the overlay mode.
 *
 * The Tauri overlay toggles click-through on/off based on cursor position
 * (hit testing happens in Rust). When click-through is off, the webview
 * receives mouse events. This hook detects clicks on face positions and
 * triggers the onFaceClick callback, and tracks hover state.
 *
 * Dragging the overlay window is handled entirely in Rust (CoreGraphics
 * mousedown + movement detection). The frontend only needs to suppress
 * clicks when a drag occurred (detected by movement threshold).
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

/** Movement threshold to suppress click when Rust initiated a drag */
const DRAG_THRESHOLD = 5;

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

  useEffect(() => {
    const canvas = gl.domElement;

    // Track mousedown position to distinguish click from drag.
    // We track dragged separately because Rust moves the window during drag,
    // which shifts the coordinate system — so clientX/clientY at mouseup can
    // appear close to mousedown even after a large drag.
    let mouseDownPos: { x: number; y: number } | null = null;
    let mouseDownHit: string | null = null;
    let didDrag = false;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTest(x, y);
      if (hit) {
        mouseDownPos = { x: e.clientX, y: e.clientY };
        mouseDownHit = hit;
        didDrag = false;
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = hitTest(x, y);

      // Show grabbing cursor when dragging (Rust is moving the window)
      if (mouseDownPos) {
        const dx = e.clientX - mouseDownPos.x;
        const dy = e.clientY - mouseDownPos.y;
        if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
          didDrag = true;
          canvas.style.cursor = "grabbing";
          return;
        }
      }

      canvas.style.cursor = hit ? "grab" : "";
      setHovered(hit);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;

      // Only fire click if no drag movement was detected during this gesture
      if (mouseDownPos && mouseDownHit && !didDrag) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const hit = hitTest(x, y);
        if (hit && hit === mouseDownHit) {
          onFaceClick(hit);
        }
      }

      mouseDownPos = null;
      mouseDownHit = null;
      didDrag = false;
      canvas.style.cursor = "";
    };

    const onMouseLeave = () => {
      canvas.style.cursor = "";
      setHovered(null);
      // Don't clear mouseDown state — Rust handles drag even outside window
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseLeave);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseLeave);
    };
  }, [gl, hitTest, setHovered, onFaceClick]);

  return { updateFaceTargets };
}
