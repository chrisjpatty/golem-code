export type OutputEntry =
  | { kind: "session-init"; model: string; cwd: string }
  | { kind: "user-message"; text: string }
  | { kind: "text"; text: string; streaming: boolean }
  | { kind: "thinking"; text: string; streaming: boolean }
  | { kind: "tool-start"; toolName: string; summary: string }
  | { kind: "edit-diff"; filePath: string; oldString: string; newString: string }
  | { kind: "tool-result"; text: string; toolName?: string }
  | { kind: "permission-request"; requestId: string; toolName: string; summary: string; status: "pending" | "approved" | "always-approved" | "denied"; decisionReason?: string; suggestions?: Array<{ update: unknown; label: string }> }
  | { kind: "question-ask"; requestId: string; questions: Array<{ question: string; header: string; options: Array<{ label: string; description: string }>; multiSelect: boolean }>; status: "pending" | "answered"; selectedAnswers?: Record<string, string> }
  | { kind: "tool-summary"; summary: string }
  | { kind: "status-update"; status: "compacting" | null }
  | { kind: "queued-message"; text: string; status: "queued" | "sending" | "cancelled" }
  | { kind: "session-result"; cost: number; inputTokens: number; outputTokens: number; durationMs: number };
