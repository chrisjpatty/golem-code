/**
 * Golem events — minimal protocol for the ambient companion.
 * All events carry an agentId so the frontend can route them
 * to the correct face in multi-instance setups.
 */

// -- Server → Client events --

export type GolemToolStart = {
  type: "tool:start";
  agentId: string;
  toolUseId: string;
  toolName: string;
};

export type GolemToolEnd = {
  type: "tool:end";
  agentId: string;
  toolUseId: string;
};

export type GolemSubagentStart = {
  type: "subagent:start";
  agentId: string;
  toolUseId: string;
  description: string;
};

export type GolemSubagentEnd = {
  type: "subagent:end";
  agentId: string;
  toolUseId: string;
};

export type GolemActivity = {
  type: "activity";
  agentId: string;
  state: "active" | "idle";
};

export type GolemPermissionRequest = {
  type: "permission:request";
  agentId: string;
  toolName: string;
};

export type GolemTurnEnd = {
  type: "turn:end";
  agentId: string;
};

export type GolemAgentInit = {
  type: "agent:init";
  agentId: string;
  seed: number;
  color: string;
};

export type GolemAgentDisconnect = {
  type: "agent:disconnect";
  agentId: string;
};

export type GolemEvent =
  | GolemToolStart
  | GolemToolEnd
  | GolemSubagentStart
  | GolemSubagentEnd
  | GolemActivity
  | GolemPermissionRequest
  | GolemTurnEnd
  | GolemAgentInit
  | GolemAgentDisconnect;

// -- Client → Server commands --

export type GolemCommand =
  | { type: "inject"; text: string };
