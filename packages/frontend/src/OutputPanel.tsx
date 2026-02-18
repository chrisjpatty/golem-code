import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import { useVirtualizer } from "@tanstack/react-virtual";
import { computeLineDiff, type DiffLine } from "./diff";
import { colors, fonts, fontSizes } from "./theme";
import type { OutputEntry } from "./types";

export type { OutputEntry } from "./types";

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
    <div style={{ color: colors.textFaint, fontSize: 11, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <span style={{ color: colors.textDim }}>model:</span> {entry.model} &nbsp;
      <span style={{ color: colors.textDim }}>cwd:</span> {entry.cwd}
    </div>
  );
}

function UserMessageBlock({ entry }: { entry: Extract<OutputEntry, { kind: "user-message" }> }) {
  return (
    <div style={{ color: colors.accent, fontSize: 13, fontFamily: fonts.mono, padding: "10px 0 6px", marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
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
      <h3 style={{ color: colors.text, fontSize: 14, margin: "0.8em 0 0.3em" }}>{children}</h3>
    ),
    h4: ({ children }) => (
      <h4 style={{ color: colors.text, fontSize: 13, margin: "0.7em 0 0.3em" }}>{children}</h4>
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
          <code style={{ color: "#ccc", fontFamily: fonts.mono, fontSize: 12, lineHeight: 1.5 }}>
            {children}
          </code>
        );
      }
      return (
        <code style={{ background: "rgba(255,255,255,0.08)", padding: "1px 5px", borderRadius: 3, fontFamily: fonts.mono, fontSize: "0.9em", color }}>
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
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: colors.accent }}>
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
    <div style={{ color: colors.text, fontFamily: fonts.mono, fontSize: 13, padding: "6px 0", lineHeight: 1.5 }}>
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
          color: colors.textFaintest,
          cursor: "pointer",
          fontFamily: fonts.mono,
          fontSize: 11,
          padding: 0,
        }}
      >
        {expanded ? "▼" : "▶"} thinking...
      </button>
      {expanded && (
        <div style={{ color: colors.textFaintest, fontFamily: fonts.mono, fontSize: 12, padding: "4px 0 4px 12px", lineHeight: 1.4 }}>
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
        borderLeft: `3px solid ${colors.accent}`,
        padding: "6px 0 6px 10px",
        margin: "4px 0",
      }}
    >
      <span style={{ color: colors.accent, fontWeight: "bold", fontSize: 12 }}>{entry.toolName}</span>
      {entry.summary && (
        <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.mono, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
        <span style={{ color: colors.accent, fontWeight: "bold", fontSize: 12 }}>Edit</span>
        <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.filePath}
        </span>
        <span style={{ color: colors.textFaint, fontSize: 10, marginLeft: "auto", flexShrink: 0 }}>
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
          fontFamily: fonts.mono,
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
        color: colors.textFaintest,
        fontSize: 11,
        fontStyle: "italic",
        textAlign: "center",
      }}>
        {line.text}
      </div>
    );
  }

  const styles: Record<string, { bg: string; color: string; prefix: string }> = {
    add: { bg: colors.diffAdd, color: colors.diffAddText, prefix: "+" },
    remove: { bg: colors.diffRemove, color: colors.diffRemoveText, prefix: "-" },
    context: { bg: "transparent", color: colors.textDim, prefix: " " },
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
      <pre style={{ color: "#777", fontSize: 11, fontFamily: fonts.mono, margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.3, maxHeight: expanded ? "none" : 180, overflow: "hidden" }}>
        {displayText}
      </pre>
      {truncated && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          style={{ background: "none", border: "none", color: colors.accent, cursor: "pointer", fontFamily: fonts.mono, fontSize: 11, padding: "4px 0 0 0" }}
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
      <div style={{ borderLeft: `3px solid ${colors.accent}`, padding: "6px 0 6px 10px", margin: "4px 0" }}>
        <span style={{ color: colors.accent, fontWeight: "bold", fontSize: 12 }}>{entry.toolName}</span>
        <span style={{ color: colors.success, fontSize: 11, marginLeft: 8 }}>
          &#10003; {entry.status === "always-approved" ? "always allowed" : "approved"}
        </span>
        {entry.summary && (
          <div style={{ color: colors.textMuted, fontSize: 11, fontFamily: fonts.mono, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.summary}
          </div>
        )}
      </div>
    );
  }

  if (entry.status === "denied") {
    return (
      <div style={{ borderLeft: "3px solid rgba(255,102,68,0.3)", padding: "6px 0 6px 10px", margin: "4px 0", opacity: 0.6 }}>
        <span style={{ color: colors.textDim, fontWeight: "bold", fontSize: 12 }}>{entry.toolName}</span>
        <span style={{ color: colors.error, fontSize: 11, marginLeft: 8 }}>&#10007; denied</span>
        {entry.summary && (
          <div style={{ color: colors.textFaint, fontSize: 11, fontFamily: fonts.mono, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
      borderTop: `1px solid ${colors.border}`,
      padding: "10px 16px",
      background: colors.panelBgSolid,
    }}>
      <div style={{ borderLeft: `3px solid ${colors.accent}`, padding: "8px 0 8px 10px" }}>
        <div style={{ fontSize: 12, fontWeight: "bold", color: colors.accent, marginBottom: 4 }}>
          Tool Approval
          {queuedCount > 0 && (
            <span style={{ color: colors.textMuted, fontWeight: "normal", marginLeft: 8 }}>
              +{queuedCount} queued
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "#fff", marginBottom: 4 }}>{entry.toolName}</div>
        {entry.decisionReason && (
          <div style={{ fontSize: 11, color: colors.textDim, fontStyle: "italic", marginBottom: 6 }}>
            {entry.decisionReason}
          </div>
        )}
        {entry.summary && (
          <div style={{
            fontSize: 12,
            color: "#aaa",
            background: "rgba(255,255,255,0.05)",
            border: `1px solid ${colors.borderLight}`,
            borderRadius: 4,
            padding: "6px 8px",
            marginBottom: 8,
            maxHeight: 80,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: fonts.mono,
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
              background: colors.accent,
              color: "#fff",
              fontFamily: fonts.mono,
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
                border: `1px solid ${colors.accent}`,
                borderRadius: 4,
                background: "transparent",
                color: colors.accent,
                fontFamily: fonts.mono,
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
              border: `1px solid ${colors.borderMedium}`,
              borderRadius: 4,
              background: "rgba(255,255,255,0.08)",
              color: "#ccc",
              fontFamily: fonts.mono,
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
              <div key={i} style={{ fontSize: 10, color: colors.textFaint, fontFamily: fonts.mono }}>
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
    <div style={{ color: colors.textDim, fontSize: 11, fontFamily: fonts.mono, padding: "4px 0 4px 13px", borderLeft: "3px solid rgba(255,102,68,0.15)", margin: "4px 0", fontStyle: "italic" }}>
      {entry.summary}
    </div>
  );
}

function StatusUpdateBlock({ entry }: { entry: Extract<OutputEntry, { kind: "status-update" }> }) {
  if (entry.status === null) return null;
  return (
    <div style={{ color: colors.textFaint, fontSize: 11, padding: "6px 0", fontFamily: fonts.mono }}>
      <span style={{ color: colors.accent }}>...</span> {entry.status === "compacting" ? "compacting context" : entry.status}
    </div>
  );
}

function SessionResultBlock({ entry }: { entry: Extract<OutputEntry, { kind: "session-result" }> }) {
  const duration = (entry.durationMs / 1000).toFixed(1);
  const cost = entry.cost.toFixed(4);
  return (
    <div style={{ color: colors.textFaint, fontSize: 11, padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.05)", marginTop: 8 }}>
      <span style={{ color: colors.textDim }}>done</span> in {duration}s &nbsp;
      <span style={{ color: colors.textDim }}>cost:</span> ${cost} &nbsp;
      <span style={{ color: colors.textDim }}>tokens:</span> {entry.inputTokens.toLocaleString()}↓ {entry.outputTokens.toLocaleString()}↑
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
          background: colors.panelBg,
          border: "1px solid rgba(204, 17, 17, 0.4)",
          borderRadius: 6,
          transform: open ? "translateX(0)" : "translateX(calc(100% + 24px))",
          transition: "transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)",
          zIndex: 20,
          display: "flex",
          flexDirection: "column",
          fontFamily: fonts.mono,
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
            borderBottom: `1px solid ${colors.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ color: colors.textFaint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Output</span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: `1px solid ${colors.borderLight}`,
              color: colors.textFaint,
              cursor: "pointer",
              fontFamily: fonts.mono,
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
