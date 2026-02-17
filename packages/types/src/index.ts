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

export type GolemPermissionSuggestion = {
  update: unknown;   // opaque PermissionUpdate — frontend never inspects
  label: string;     // human-readable, generated server-side
};

export type GolemPermissionRequest = {
  type: "permission:request";
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  decisionReason?: string;
  suggestions?: GolemPermissionSuggestion[];
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

// -- Voice / STT / TTS --

export type GolemSttTranscript = {
  type: "stt:transcript";
  text: string;
  isFinal: boolean;
  timestamp: number;
};

export type GolemTtsStart = {
  type: "tts:start";
  text: string;
  sampleRate: number;
  timestamp: number;
};

export type GolemTtsEnd = {
  type: "tts:end";
  timestamp: number;
};

export type GolemSpeechText = {
  type: "speech:text";
  original: string;
  summarized: string;
  mode: "response" | "tool_intent";
  timestamp: number;
};

// -- Tool use summary --

export type GolemToolUseSummary = {
  type: "tool:summary";
  summary: string;
  toolUseIds: string[];
  timestamp: number;
};

// -- Status updates --

export type GolemStatusUpdate = {
  type: "status:update";
  status: "compacting" | null;
  timestamp: number;
};

// -- Conversation --

export type GolemConversationCleared = {
  type: "conversation:cleared";
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
  | GolemToolUseSummary
  | GolemSubagentStart
  | GolemSubagentComplete
  | GolemPermissionRequest
  | GolemQuestionAsk
  | GolemStatusUpdate
  | GolemSttTranscript
  | GolemTtsStart
  | GolemTtsEnd
  | GolemSpeechText
  | GolemConversationCleared;

// -- Client → Server commands --

export type GolemCommand =
  | { type: "query:start"; prompt: string }
  | { type: "query:stop" }
  | { type: "permission:response"; requestId: string; decision: "allow" | "allow-always" | "deny" }
  | { type: "question:answer"; requestId: string; answers: Record<string, string> }
  | { type: "voice:start"; sampleRate: number }
  | { type: "voice:stop" }
  | { type: "conversation:clear" };
