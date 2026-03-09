import { useRef, useState, useCallback } from "react";
import type { GolemCommand } from "@golem-code/types";
import type { OutputEntry } from "../types";
import { summarizeToolInput } from "../outputUtils";

type PermissionDecision = "allow" | "allow-always" | "deny";

export function usePermissions(
  sendCommandRef: React.RefObject<((cmd: GolemCommand) => void) | undefined>,
  setOutputEntries: React.Dispatch<React.SetStateAction<OutputEntry[]>>,
) {
  const [autoApprove, setAutoApprove] = useState(true);
  const autoApproveRef = useRef(true);

  const handlePermissionRequest = useCallback(
    (event: { requestId: string; toolName: string; toolInput: Record<string, unknown>; decisionReason?: string; suggestions?: Array<{ update: unknown; label: string }> }) => {
      const summary = summarizeToolInput(event.toolName, event.toolInput);
      if (autoApproveRef.current) {
        sendCommandRef.current?.({
          type: "permission:response",
          requestId: event.requestId,
          decision: "allow",
        });
        // Don't add a permission-request entry — the ToolStartBlock already
        // shows the tool name + summary, so adding an "approved" permission
        // entry just creates a duplicate (matching Claude Code CLI behaviour).
      } else {
        const permEntry: Extract<OutputEntry, { kind: "permission-request" }> = {
          kind: "permission-request",
          requestId: event.requestId,
          toolName: event.toolName,
          summary,
          status: "pending" as const,
          decisionReason: event.decisionReason,
          suggestions: event.suggestions,
        };
        setOutputEntries((prev) => {
          // Replace the most recent tool-start entry for this tool so we
          // don't show a duplicate (tool-start + permission-request).
          for (let i = prev.length - 1; i >= 0; i--) {
            const entry = prev[i];
            if (entry.kind === "tool-start" && entry.toolName === event.toolName) {
              const next = [...prev];
              next[i] = permEntry;
              return next;
            }
          }
          // Fallback: no matching tool-start found (e.g. edit-diff), just append
          return [...prev, permEntry];
        });
      }
    },
    [sendCommandRef, setOutputEntries],
  );

  const handlePermissionRespond = useCallback(
    (requestId: string, decision: PermissionDecision) => {
      sendCommandRef.current?.({
        type: "permission:response",
        requestId,
        decision,
      });
      const statusMap = {
        "allow": "approved" as const,
        "allow-always": "always-approved" as const,
        "deny": "denied" as const,
      };
      setOutputEntries((prev) =>
        prev.map((entry) =>
          entry.kind === "permission-request" && entry.requestId === requestId
            ? { ...entry, status: statusMap[decision] }
            : entry,
        ),
      );
    },
    [sendCommandRef, setOutputEntries],
  );

  const toggleAutoApprove = useCallback(() => {
    setAutoApprove((prev) => {
      const next = !prev;
      autoApproveRef.current = next;
      return next;
    });
  }, []);

  return {
    autoApprove,
    handlePermissionRequest,
    handlePermissionRespond,
    toggleAutoApprove,
  };
}
