import type { GolemPermissionRequest } from "@golem-code/types";

export function PermissionPrompt({
  requests,
  onRespond,
}: {
  requests: GolemPermissionRequest[];
  onRespond: (requestId: string, allow: boolean) => void;
}) {
  if (requests.length === 0) return null;

  const current = requests[0];
  const summary = getToolSummary(current.toolName, current.toolInput);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.6)",
        zIndex: 100,
        fontFamily: "monospace",
      }}
    >
      <div
        style={{
          background: "rgba(20,10,10,0.95)",
          border: "1px solid rgba(255,255,255,0.15)",
          borderRadius: 8,
          padding: 24,
          maxWidth: 480,
          width: "90%",
          color: "#ccc",
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: "bold",
            color: "#ff6644",
            marginBottom: 12,
          }}
        >
          Tool Approval
          {requests.length > 1 && (
            <span style={{ color: "#999", fontWeight: "normal", marginLeft: 8 }}>
              +{requests.length - 1} queued
            </span>
          )}
        </div>

        <div
          style={{
            fontSize: 13,
            marginBottom: 8,
            color: "#fff",
          }}
        >
          {current.toolName}
        </div>

        <div
          style={{
            fontSize: 12,
            color: "#aaa",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            padding: "8px 10px",
            marginBottom: 16,
            maxHeight: 120,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {summary}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => onRespond(current.requestId, true)}
            style={{
              flex: 1,
              padding: "8px 16px",
              border: "none",
              borderRadius: 4,
              background: "#ff6644",
              color: "#fff",
              fontFamily: "monospace",
              fontSize: 13,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Approve
          </button>
          <button
            onClick={() => onRespond(current.requestId, false)}
            style={{
              flex: 1,
              padding: "8px 16px",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
              background: "rgba(255,255,255,0.08)",
              color: "#ccc",
              fontFamily: "monospace",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}

function getToolSummary(
  toolName: string,
  input: Record<string, unknown>,
): string {
  if (toolName === "Bash" && typeof input.command === "string") {
    return input.command;
  }
  if ((toolName === "Read" || toolName === "Write" || toolName === "Edit") && typeof input.file_path === "string") {
    return input.file_path;
  }
  if (toolName === "Glob" && typeof input.pattern === "string") {
    return input.pattern;
  }
  if (toolName === "Grep" && typeof input.pattern === "string") {
    return `/${input.pattern}/` + (input.path ? ` in ${input.path}` : "");
  }
  // Fallback: show JSON keys and short values
  const entries = Object.entries(input).slice(0, 4);
  return entries
    .map(([k, v]) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${s && s.length > 80 ? s.slice(0, 80) + "..." : s}`;
    })
    .join("\n");
}
