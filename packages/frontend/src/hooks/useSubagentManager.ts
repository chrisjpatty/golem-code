import { useRef, useState, useCallback } from "react";
import { type ActiveSubagent, type SubagentPositions } from "../SubagentFace";
import { getRandomUnusedColor } from "../faceGen";

const BASE_SCALE = 0.27;
const MIN_SCALE = 0.14;
const CROWD_THRESHOLD = 6;

function createSubagent(toolUseId: string, description: string, usedColors: Set<string>): ActiveSubagent {
  return {
    toolUseId,
    seed: Math.floor(Math.random() * 2 ** 32),
    color: getRandomUnusedColor(usedColors),
    description,
    freqX1: 0.15 + Math.random() * 0.15,
    freqX2: 0.4 + Math.random() * 0.3,
    freqY1: 0.12 + Math.random() * 0.15,
    freqY2: 0.35 + Math.random() * 0.3,
    phaseX1: Math.random() * Math.PI * 2,
    phaseX2: Math.random() * Math.PI * 2,
    phaseY1: Math.random() * Math.PI * 2,
    phaseY2: Math.random() * Math.PI * 2,
  };
}

export function useSubagentManager() {
  const [activeSubagents, setActiveSubagents] = useState<ActiveSubagent[]>([]);
  const [removingSubagents, setRemovingSubagents] = useState<Set<string>>(new Set());
  const subagentPositions = useRef<SubagentPositions>(new Map());

  const spawnSubagent = useCallback((toolUseId: string, description: string) => {
    setActiveSubagents((prev) => {
      const used = new Set(prev.map((s) => s.color));
      return [...prev, createSubagent(toolUseId, description, used)];
    });
  }, []);

  const markRemoving = useCallback((toolUseId: string) => {
    setActiveSubagents((prev) => {
      if (prev.some((s) => s.toolUseId === toolUseId)) {
        setRemovingSubagents((rs) => new Set(rs).add(toolUseId));
      }
      return prev;
    });
  }, []);

  const markAllRemoving = useCallback(() => {
    setActiveSubagents((prev) => {
      if (prev.length > 0) {
        setRemovingSubagents((rs) => {
          const next = new Set(rs);
          for (const s of prev) next.add(s.toolUseId);
          return next;
        });
      }
      return prev;
    });
  }, []);

  const onSubagentRemoved = useCallback((toolUseId: string) => {
    setActiveSubagents((prev) => prev.filter((s) => s.toolUseId !== toolUseId));
    setRemovingSubagents((prev) => {
      const next = new Set(prev);
      next.delete(toolUseId);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setActiveSubagents([]);
    setRemovingSubagents(new Set());
  }, []);

  // Dev helpers
  const devSpawn = useCallback(() => {
    setActiveSubagents((prev) => {
      const used = new Set(prev.map((s) => s.color));
      const id = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return [...prev, createSubagent(id, "dev test", used)];
    });
  }, []);

  const devRemoveOldest = useCallback(() => {
    setActiveSubagents((prev) => {
      if (prev.length === 0) return prev;
      setRemovingSubagents((rs) => new Set(rs).add(prev[0].toolUseId));
      return prev;
    });
  }, []);

  // Compute target scale based on crowd density
  const nonRemovingCount = activeSubagents.filter((s) => !removingSubagents.has(s.toolUseId)).length;
  const targetScale = nonRemovingCount <= CROWD_THRESHOLD
    ? BASE_SCALE
    : Math.max(MIN_SCALE, BASE_SCALE * CROWD_THRESHOLD / nonRemovingCount);

  return {
    activeSubagents,
    removingSubagents,
    subagentPositions,
    targetScale,
    spawnSubagent,
    markRemoving,
    markAllRemoving,
    onSubagentRemoved,
    clearAll,
    devSpawn,
    devRemoveOldest,
  };
}
