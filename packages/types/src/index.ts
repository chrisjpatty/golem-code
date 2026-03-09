/**
 * Golem events — minimal protocol for the ambient companion.
 * The frontend observes Claude Code via JSONL session file tailing.
 */

// -- Server → Client events --

export type GolemToolStart = {
  type: "tool:start";
  toolUseId: string;
  toolName: string;
};

export type GolemToolEnd = {
  type: "tool:end";
  toolUseId: string;
};

export type GolemSubagentStart = {
  type: "subagent:start";
  toolUseId: string;
  description: string;
};

export type GolemSubagentEnd = {
  type: "subagent:end";
  toolUseId: string;
};

export type GolemActivity = {
  type: "activity";
  state: "active" | "idle";
};

export type GolemTurnEnd = {
  type: "turn:end";
};

export type GolemAgentInit = {
  type: "agent:init";
  agentId: string;
  seed: number;
  color: string;
};

export type GolemEvent =
  | GolemToolStart
  | GolemToolEnd
  | GolemSubagentStart
  | GolemSubagentEnd
  | GolemActivity
  | GolemTurnEnd
  | GolemAgentInit;

// -- Client → Server commands --

export type GolemCommand =
  | { type: "inject"; text: string };
