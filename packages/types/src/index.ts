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
  | { type: "inject"; text: string }
  | { type: "focus:agent"; agentId: string };

// --- Face color palette ---

export const FACE_COLORS = [
  "#cc1111", // default red
  "#1155cc", // cobalt blue
  "#11aa44", // emerald green
  "#cc8811", // gold
  "#8822cc", // purple
  "#cc1177", // magenta
  "#11aaaa", // teal
  "#cc5511", // burnt orange
  "#4466cc", // steel blue
  "#44aa11", // lime
  "#aa1166", // raspberry
  "#888888", // silver
] as const;

export function getRandomUnusedColor(usedColors: Set<string>): string {
  const available = FACE_COLORS.filter((c) => !usedColors.has(c));
  const pool = available.length > 0 ? available : FACE_COLORS;
  return pool[Math.floor(Math.random() * pool.length)];
}
