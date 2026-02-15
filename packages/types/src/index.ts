/**
 * Golem events — simplified view of the SDK message stream
 * designed for visualization in the 3D frontend.
 */

// -- Session lifecycle --

export type GolemSessionInit = {
  type: "session:init";
  sessionId: string;
  model: string;
  tools: string[];
  cwd: string;
  timestamp: number;
};

export type GolemSessionResult = {
  type: "session:result";
  sessionId: string;
  success: boolean;
  result?: string;
  errors?: string[];
  durationMs: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
  timestamp: number;
};

// -- Assistant text --

export type GolemTextDelta = {
  type: "text:delta";
  text: string;
  timestamp: number;
};

export type GolemThinkingDelta = {
  type: "thinking:delta";
  text: string;
  timestamp: number;
};

// -- Tool use --

export type GolemToolStart = {
  type: "tool:start";
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  parentToolUseId: string | null;
  timestamp: number;
};

export type GolemToolProgress = {
  type: "tool:progress";
  toolUseId: string;
  toolName: string;
  elapsedSeconds: number;
  timestamp: number;
};

export type GolemToolResult = {
  type: "tool:result";
  toolUseId: string;
  result: unknown;
  timestamp: number;
};

// -- Subagents --

export type GolemSubagentStart = {
  type: "subagent:start";
  taskId: string;
  timestamp: number;
};

export type GolemSubagentComplete = {
  type: "subagent:complete";
  taskId: string;
  status: "completed" | "failed" | "stopped";
  summary: string;
  timestamp: number;
};

// -- Permission approval --

export type GolemPermissionRequest = {
  type: "permission:request";
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: number;
};

// -- User question (AskUserQuestion) --

export type GolemQuestionOption = {
  label: string;
  description: string;
};

export type GolemQuestion = {
  question: string;
  header: string;
  options: GolemQuestionOption[];
  multiSelect: boolean;
};

export type GolemQuestionAsk = {
  type: "question:ask";
  requestId: string;
  questions: GolemQuestion[];
  timestamp: number;
};

// -- Server → Client events union --

export type GolemEvent =
  | GolemSessionInit
  | GolemSessionResult
  | GolemTextDelta
  | GolemThinkingDelta
  | GolemToolStart
  | GolemToolProgress
  | GolemToolResult
  | GolemSubagentStart
  | GolemSubagentComplete
  | GolemPermissionRequest
  | GolemQuestionAsk;

// -- Client → Server commands --

export type GolemCommand =
  | { type: "query:start"; prompt: string }
  | { type: "query:stop" }
  | { type: "permission:response"; requestId: string; allow: boolean }
  | { type: "question:answer"; requestId: string; answers: Record<string, string> };
