import { useState, useCallback } from "react";
import type { OutputEntry } from "../types";
import { summarizeToolInput, formatToolResult } from "../OutputPanel";

export function useOutputEntries() {
  const [outputEntries, setOutputEntries] = useState<OutputEntry[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const addUserMessage = useCallback((text: string) => {
    setOutputEntries((prev) => [...prev, { kind: "user-message", text }]);
  }, []);

  const addToolStart = useCallback((toolName: string, input: Record<string, unknown>) => {
    if (
      toolName === "Edit" &&
      typeof input.old_string === "string" &&
      typeof input.new_string === "string"
    ) {
      setOutputEntries((prev) => [
        ...prev,
        {
          kind: "edit-diff",
          filePath: String(input.file_path ?? ""),
          oldString: input.old_string as string,
          newString: input.new_string as string,
        },
      ]);
    } else {
      setOutputEntries((prev) => [
        ...prev,
        { kind: "tool-start", toolName, summary: summarizeToolInput(toolName, input) },
      ]);
    }
  }, []);

  const addToolResult = useCallback((result: unknown) => {
    setOutputEntries((prev) => [
      ...prev,
      { kind: "tool-result", text: formatToolResult(result) },
    ]);
  }, []);

  const addToolSummary = useCallback((summary: string) => {
    setOutputEntries((prev) => [...prev, { kind: "tool-summary", summary }]);
  }, []);

  const addStatusUpdate = useCallback((status: "compacting" | null) => {
    setOutputEntries((prev) => [...prev, { kind: "status-update", status }]);
  }, []);

  const addSessionResult = useCallback((data: { totalCostUsd: number; inputTokens: number; outputTokens: number; durationMs: number }) => {
    setOutputEntries((prev) => [
      ...prev,
      {
        kind: "session-result",
        cost: data.totalCostUsd,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        durationMs: data.durationMs,
      },
    ]);
  }, []);

  const clearAll = useCallback(() => {
    setOutputEntries([]);
    setPanelOpen(false);
  }, []);

  return {
    outputEntries,
    setOutputEntries,
    panelOpen,
    openPanel,
    closePanel,
    addUserMessage,
    addToolStart,
    addToolResult,
    addToolSummary,
    addStatusUpdate,
    addSessionResult,
    clearAll,
  };
}
