import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import { useVirtualizer } from "@tanstack/react-virtual";
import { computeLineDiff, type DiffLine } from "./diff";

// -- Entry types --

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

type OutputPanelProps = {
  open: boolean;
  entries: OutputEntry[];
  onClose: () => void;
  onPermissionRespond: (requestId: string, decision: "allow" | "allow-always" | "deny") => void;
};

// Summarize tool input into a short one-liner
export function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "Write":
      return String(input.file_path ?? "");
    case "Edit":
      return String(input.file_path ?? "");
    case "Bash":
      return String(input.command ?? "").slice(0, 120);
    case "Grep":
      return `/${input.pattern ?? ""}/ ${input.path ?? ""}`;
    case "Glob":
      return `${input.pattern ?? ""} ${input.path ?? ""}`;
    case "Task":
      return String(input.description ?? "");
    default: {
      const keys = Object.keys(input);
      if (keys.length === 0) return "";
      const first = input[keys[0]];
      return typeof first === "string" ? first.slice(0, 100) : JSON.stringify(first)?.slice(0, 100) ?? "";
    }
  }
}

// Truncate tool result to a displayable string.
// Tool result `content` from the Anthropic API can be a plain string
// OR an array of content blocks like [{type:"text", text:"..."}].
export function formatToolResult(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    const texts = result
      .filter((b): b is { type: string; text: string } =>
        typeof b === "object" && b !== null && b.type === "text" && typeof b.text === "string",
      )
      .map((b) => b.text);
    if (texts.length > 0) return texts.join("\n");
  }
  return JSON.stringify(result, null, 2);
}

function SessionInitBlock({ entry }: { entry: Extract<OutputEntry, { kind: "session-init" }> }) {
  return (
    <div style={{ color: "#666", fontSize: 11, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ color: "#888" }}>model:</span> {entry.model} &nbsp;
      <span style={{ color: "#888" }}>cwd:</span> {entry.cwd}
    </div>
  );
}

function UserMessageBlock({ entry }: { entry: Extract<OutputEntry, { kind: "user-message" }> }) {
  return (
    <div style={{ color: "#ff6644", fontSize: 13, fontFamily: "monospace", padding: "10px 0 6px", marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
      &gt; {entry.text}
    </div>
  );
}

function mdComponents(color: string): Components {
  const listBase = { color, margin: "0.6em 0", paddingLeft: 0, marginLeft: 24, lineHeight: 1.6, listStylePosition: "outside" as const };
  return {
    p: ({ children }) => (
      <p style={{ color, margin: "0.6em 0", lineHeight: 1.6 }}>{children}</p>
    ),
    h1: ({ children }) => (
      <h1 style={{ color: "#eee", fontSize: 18, margin: "1em 0 0.4em" }}>{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 style={{ color: "#eee", fontSize: 16, margin: "0.9em 0 0.4em" }}>{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 style={{ color: "#ddd", fontSize: 14, margin: "0.8em 0 0.3em" }}>{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 style={{ color: "#ddd", fontSize: 13, margin: "0.7em 0 0.3em" }}>{children}</h4>
    ),
    pre: ({ children }) => (
      <pre style={{ background: "rgba(0,0,0,0.4)", padding: "10px 12px", borderRadius: 4, overflowX: "auto", margin: "0.8em 0" }}>
        {children}
      </pre>
    ),
    code: ({ children, className }) => {
      const isBlock = !!className || false;
      if (isBlock) {
        return (
          <code style={{ color: "#ccc", fontFamily: "monospace", fontSize: 12, lineHeight: 1.5 }}>
            {children}
          </code>
        );
      }
      return (
        <code style={{ background: "rgba(255,255,255,0.08)", padding: "1px 5px", borderRadius: 3, fontFamily: "monospace", fontSize: "0.9em", color }}>
          {children}
        </code>
      );
    },
    ul: ({ children }) => (
      <ul style={listBase}>{children}</ul>
    ),
    ol: ({ children }) => (
      <ol style={{ ...listBase, paddingLeft: 6 }}>{children}</ol>
    ),
    li: ({ children }) => (
      <li style={{ color, marginBottom: 4, lineHeight: 1.6 }}>{children}</li>
    ),
    a: ({ children, href }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "#ff6644" }}>
        {children}
      </a>
    ),
    strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
    em: ({ children }) => <em>{children}</em>,
  };
}

const textMdComponents = mdComponents("#ddd");
const thinkingMdComponents = mdComponents("#555");

function TextBlock({ entry }: { entry: Extract<OutputEntry, { kind: "text" }> }) {
  return (
    <div style={{ color: "#ddd", fontFamily: "monospace", fontSize: 13, padding: "6px 0", lineHeight: 1.5 }}>
      <Markdown components={textMdComponents}>{entry.text}</Markdown>
    </div>
  );
}

function ThinkingBlock({ entry }: { entry: Extract<OutputEntry, { kind: "thinking" }> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ padding: "4px 0" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none",
          border: "none",
          color: "#555",
          cursor: "pointer",
          fontFamily: "monospace",
          fontSize: 11,
          padding: 0,
        }}
      >
        {expanded ? "▼" : "▶"} thinking...
      </button>
      {expanded && (
        <div style={{ color: "#555", fontFamily: "monospace", fontSize: 12, padding: "4px 0 4px 12px", lineHeight: 1.4 }}>
          <Markdown components={thinkingMdComponents}>{entry.text}</Markdown>
        </div>
      )}
    </div>
  );
}

function ToolStartBlock({ entry }: { entry: Extract<OutputEntry, { kind: "tool-start" }> }) {
  return (
    <div
      style={{
        borderLeft: "3px solid #ff6644",
        padding: "6px 0 6px 10px",
        margin: "4px 0",
      }}
    >
      <span style={{ color: "#ff6644", fontWeight: "bold", fontSize: 12 }}>{entry.toolName}</span>
      {entry.summary && (
        <div style={{ color: "#999", fontSize: 11, fontFamily: "monospace", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.summary}
        </div>
      )}
    </div>
  );
}

function EditDiffBlock({ entry }: { entry: Extract<OutputEntry, { kind: "edit-diff" }> }) {
  const [expanded, setExpanded] = useState(true);
  const diffLines = useMemo(() => computeLineDiff(entry.oldString, entry.newString), [entry.oldString, entry.newString]);

  return (
    <div style={{ margin: "4px 0" }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
        }}
      >
        <span style={{ color: "#ff6644", fontWeight: "bold", fontSize: 12 }}>Edit</span>
        <span style={{ color: "#999", fontSize: 11, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.filePath}
        </span>
        <span style={{ color: "#666", fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>
          {expanded ? "▼" : "▶"}
        </span>
      </button>
      {expanded && (
        <div style={{
          marginTop: 4,
          borderRadius: 4,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
          fontSize: 12,
          fontFamily: "monospace",
          lineHeight: 1.5,
        }}>
          {diffLines.map((line, i) => (
            <DiffLineRow key={i} line={line} />
          ))}
        </div>
      )}
    </div>
  );
}

function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === "separator") {
    return (
      <div style={{
        padding: "2px 8px",
        background: "rgba(255,255,255,0.03)",
        color: "#555",
        fontSize: 11,
        fontStyle: "italic",
        textAlign: "center",
      }}>
        {line.text}
      </div>
    );
  }

  const styles: Record<string, { bg: string; color: string; prefix: string }> = {
    add: { bg: "rgba(40, 160, 60, 0.15)", color: "#6c6", prefix: "+" },
    remove: { bg: "rgba(200, 50, 50, 0.15)", color: "#c66", prefix: "-" },
    context: { bg: "transparent", color: "#888", prefix: " " },
  };
  const s = styles[line.type];

  return (
    <div style={{
      padding: "0 8px",
      background: s.bg,
      color: s.color,
      whiteSpace: "pre-wrap",
      wordBreak: "break-all",
    }}>
      <span style={{ userSelect: "none", opacity: 0.5, marginRight: 4 }}>{s.prefix}</span>
      {line.text}
    </div>
  );
}

function ToolResultBlock({ entry }: { entry: Extract<OutputEntry, { kind: "tool-result" }> }) {
  const [expanded, setExpanded] = useState(false);
  const lines = entry.text.split("\n");
  const truncated = lines.length > 10;
  const displayText = expanded ? entry.text : lines.slice(0, 10).join("\n");

  return (
    <div style={{ padding: "2px 0 6px 13px", borderLeft: "3px solid rgba(255,102,68,0.2)" }}>
      <pre style={{ color: "#777", fontSize: 11, fontFamily: "monospace", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.3, maxHeight: expanded ? "none" : 180, overflow: "hidden" }}>
        {displayText}
      </pre>
      {truncated && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{ background: "none", border: "none", color: "#ff6644", cursor: "pointer", fontFamily: "monospace", fontSize: 11, padding: "4px 0 0 0" }}
        >
          Show more ({lines.length - 10} lines)
        </button>
      )}
    </div>
  );
}

function PermissionResolvedBlock({
  entry,
}: {
  entry: Extract<OutputEntry, { kind: "permission-request" }>;
}) {
  if (entry.status === "approved" || entry.status === "always-approved") {
    return (
      <div style={{ borderLeft: "3px solid #ff6644", padding: "6px 0 6px 10px", margin: "4px 0" }}>
        <span style={{ color: "#ff6644", fontWeight: "bold", fontSize: 12 }}>{entry.toolName}</span>
        <span style={{ color: "#4a4", fontSize: 11, marginLeft: 8 }}>
          &#10003; {entry.status === "always-approved" ? "always allowed" : "approved"}
        </span>
        {entry.summary && (
          <div style={{ color: "#999", fontSize: 11, fontFamily: "monospace", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.summary}
          </div>
        )}
      </div>
    );
  }

  if (entry.status === "denied") {
    return (
      <div style={{ borderLeft: "3px solid rgba(255,102,68,0.3)", padding: "6px 0 6px 10px", margin: "4px 0", opacity: 0.6 }}>
        <span style={{ color: "#888", fontWeight: "bold", fontSize: 12 }}>{entry.toolName}</span>
        <span style={{ color: "#c44", fontSize: 11, marginLeft: 8 }}>&#10007; denied</span>
        {entry.summary && (
          <div style={{ color: "#666", fontSize: 11, fontFamily: "monospace", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.summary}
          </div>
        )}
      </div>
    );
  }

  // Pending entries are rendered in the sticky footer, not inline
  return null;
}

function PermissionFooter({
  entry,
  queuedCount,
  onRespond,
}: {
  entry: Extract<OutputEntry, { kind: "permission-request" }>;
  queuedCount: number;
  onRespond: (requestId: string, decision: "allow" | "allow-always" | "deny") => void;
}) {
  return (
    <div style={{
      flexShrink: 0,
      borderTop: "1px solid rgba(255,255,255,0.06)",
      padding: "10px 16px",
      background: "rgba(10, 10, 10, 0.95)",
    }}>
      <div style={{ borderLeft: "3px solid #ff6644", padding: "8px 0 8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: "bold", color: "#ff6644", marginBottom: 4 }}>
          Tool Approval
          {queuedCount > 0 && (
            <span style={{ color: "#999", fontWeight: "normal", marginLeft: 8 }}>
              +{queuedCount} queued
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "#fff", marginBottom: 4 }}>{entry.toolName}</div>
        {entry.decisionReason && (
          <div style={{ fontSize: 11, color: "#888", fontStyle: "italic", marginBottom: 6 }}>
            {entry.decisionReason}
          </div>
        )}
        {entry.summary && (
          <div style={{
            fontSize: 12,
            color: "#aaa",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4,
            padding: "6px 8px",
            marginBottom: 8,
            maxHeight: 80,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "monospace",
          }}>
            {entry.summary}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => onRespond(entry.requestId, "allow")}
            style={{
              padding: "5px 14px",
              border: "none",
              borderRadius: 4,
              background: "#ff6644",
              color: "#fff",
              fontFamily: "monospace",
              fontSize: 12,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Approve
          </button>
          {entry.suggestions && entry.suggestions.length > 0 && (
            <button
              onClick={() => onRespond(entry.requestId, "allow-always")}
              style={{
                padding: "5px 14px",
                border: "1px solid #ff6644",
                borderRadius: 4,
                background: "transparent",
                color: "#ff6644",
                fontFamily: "monospace",
                fontSize: 12,
                fontWeight: "bold",
                cursor: "pointer",
              }}
            >
              Always Allow
            </button>
          )}
          <button
            onClick={() => onRespond(entry.requestId, "deny")}
            style={{
              padding: "5px 14px",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 4,
              background: "rgba(255,255,255,0.08)",
              color: "#ccc",
              fontFamily: "monospace",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Deny
          </button>
        </div>
        {entry.suggestions && entry.suggestions.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {entry.suggestions.map((s, i) => (
              <div key={i} style={{ fontSize: 10, color: "#666", fontFamily: "monospace" }}>
                {s.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolSummaryBlock({ entry }: { entry: Extract<OutputEntry, { kind: "tool-summary" }> }) {
  return (
    <div style={{ color: "#888", fontSize: 11, fontFamily: "monospace", padding: "4px 0 4px 13px", borderLeft: "3px solid rgba(255,102,68,0.15)", margin: "4px 0", fontStyle: "italic" }}>
      {entry.summary}
    </div>
  );
}

function StatusUpdateBlock({ entry }: { entry: Extract<OutputEntry, { kind: "status-update" }> }) {
  if (entry.status === null) return null;
  return (
    <div style={{ color: "#666", fontSize: 11, padding: "6px 0", fontFamily: "monospace" }}>
      <span style={{ color: "#ff6644" }}>...</span> {entry.status === "compacting" ? "compacting context" : entry.status}
    </div>
  );
}

function SessionResultBlock({ entry }: { entry: Extract<OutputEntry, { kind: "session-result" }> }) {
  const duration = (entry.durationMs / 1000).toFixed(1);
  const cost = entry.cost.toFixed(4);
  return (
    <div style={{ color: "#666", fontSize: 11, padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.05)", marginTop: 8 }}>
      <span style={{ color: "#888" }}>done</span> in {duration}s &nbsp;
      <span style={{ color: "#888" }}>cost:</span> ${cost} &nbsp;
      <span style={{ color: "#888" }}>tokens:</span> {entry.inputTokens.toLocaleString()}↓ {entry.outputTokens.toLocaleString()}↑
    </div>
  );
}

function EntryRenderer({ entry }: { entry: OutputEntry }) {
  switch (entry.kind) {
    case "session-init":
      return <SessionInitBlock entry={entry} />;
    case "user-message":
      return <UserMessageBlock entry={entry} />;
    case "text":
      return <TextBlock entry={entry} />;
    case "thinking":
      return <ThinkingBlock entry={entry} />;
    case "tool-start":
      return <ToolStartBlock entry={entry} />;
    case "edit-diff":
      return <EditDiffBlock entry={entry} />;
    case "tool-result":
      return <ToolResultBlock entry={entry} />;
    case "permission-request":
      return <PermissionResolvedBlock entry={entry} />;
    case "tool-summary":
      return <ToolSummaryBlock entry={entry} />;
    case "status-update":
      return <StatusUpdateBlock entry={entry} />;
    case "session-result":
      return <SessionResultBlock entry={entry} />;
  }
}

export function OutputPanel({ open, entries, onClose, onPermissionRespond }: OutputPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Find the first pending permission request and total pending count for the sticky footer
  const { activePermission, pendingPermissionCount } = useMemo(() => {
    let active: Extract<OutputEntry, { kind: "permission-request" }> | null = null;
    let count = 0;
    for (const entry of entries) {
      if (entry.kind === "permission-request" && entry.status === "pending") {
        if (active === null) active = entry;
        count++;
      }
    }
    return { activePermission: active, pendingPermissionCount: count };
  }, [entries]);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 10,
  });

  // Track whether user has scrolled up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  }, []);

  // Auto-scroll on new entries
  useEffect(() => {
    if (autoScrollRef.current && entries.length > 0) {
      virtualizer.scrollToIndex(entries.length - 1, { align: "end" });
    }
  }, [entries, virtualizer]);

  return (
      <div
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          width: "calc(50% - 24px)",
          height: "calc(100vh - 24px)",
          background: "rgba(10, 10, 10, 0.78)",
          border: "1px solid rgba(204, 17, 17, 0.4)",
          borderRadius: 6,
          transform: open ? "translateX(0)" : "translateX(calc(100% + 24px))",
          transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          fontFamily: "monospace",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            flexShrink: 0,
          }}
        >
          <span style={{ color: "#666", fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Output</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#666",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 13,
              padding: "2px 8px",
              borderRadius: 3,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#ccc")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#666")}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0 16px",
          }}
        >
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => (
              <div
                key={virtualItem.index}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                <EntryRenderer entry={entries[virtualItem.index]} />
              </div>
            ))}
          </div>
        </div>

        {/* Sticky permission approval footer */}
        {activePermission && (
          <PermissionFooter
            entry={activePermission}
            queuedCount={pendingPermissionCount - 1}
            onRespond={onPermissionRespond}
          />
        )}
      </div>
  );
}
