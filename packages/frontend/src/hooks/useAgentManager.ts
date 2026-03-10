import { useState, useCallback } from "react";

export type AgentInfo = {
  agentId: string;
  seed: number;
  color: string;
};

/**
 * Tracks the set of connected agents. Returns stable add/remove callbacks
 * and the ordered agent list. Each agent gets rendered as its own
 * AgentSlot component which manages its own face ref and subagents.
 *
 * Agents marked as "removing" animate out before being removed from the list.
 */
export function useAgentManager() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [removingAgents, setRemovingAgents] = useState<Set<string>>(new Set());

  const addAgent = useCallback((agentId: string, seed: number, color: string) => {
    setAgents((prev) => {
      if (prev.some((a) => a.agentId === agentId)) return prev;
      return [...prev, { agentId, seed, color }];
    });
  }, []);

  const markRemoving = useCallback((agentId: string) => {
    setRemovingAgents((prev) => {
      const next = new Set(prev);
      next.add(agentId);
      return next;
    });
  }, []);

  const onAgentRemoved = useCallback((agentId: string) => {
    setAgents((prev) => prev.filter((a) => a.agentId !== agentId));
    setRemovingAgents((prev) => {
      const next = new Set(prev);
      next.delete(agentId);
      return next;
    });
  }, []);

  return { agents, removingAgents, addAgent, markRemoving, onAgentRemoved };
}
