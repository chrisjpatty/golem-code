export type OutputEntry =
  | { kind: "session-init"; model: string; cwd: string }
  | { kind: "user-message"; text: string }
  | { kind: "text"; text: string; streaming: boolean }
  | { kind: "thinking"; text: string; streaming: boolean }
  | { kind: "tool-start"; toolName: string; summary: string }
  | { kind: "edit-diff"; filePath: string; oldString: string; newString: string }
  | { kind: "tool-result"; text: string }
  | { kind: "permission-request"; requestId: string; toolName: string; summary: string; status: "pending" | "approved" | "always-approved" | "denied"; decisionReason?: string; suggestions?: Array<{ update: unknown; label: string }> }
  | { kind: "tool-summary"; summary: string }
  | { kind: "status-update"; status: "compacting" | null }
  | { kind: "session-result"; cost: number; inputTokens: number; outputTokens: number; durationMs: number };
