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
 */
export function useAgentManager() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  const addAgent = useCallback((agentId: string, seed: number, color: string) => {
    setAgents((prev) => {
      if (prev.some((a) => a.agentId === agentId)) return prev;
      return [...prev, { agentId, seed, color }];
    });
  }, []);

  const removeAgent = useCallback((agentId: string) => {
    setAgents((prev) => prev.filter((a) => a.agentId !== agentId));
  }, []);

  return { agents, addAgent, removeAgent };
}
