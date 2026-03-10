/**
 * Maps raw JSONL events from Claude Code session files to GolemEvents.
 *
 * Claude Code JSONL format:
 * - type: "assistant" with content blocks including tool_use
 * - type: "user" with content blocks including tool_result
 * - type: "system" with subtype: "turn_duration"
 * - type: "progress"
 */

import type { GolemEvent } from "@golem-code/types";

export type JsonlTransformOptions = {
  onEvent: (event: GolemEvent) => void;
};

const SUBAGENT_TOOL_NAME = "Task";

export function createJsonlTransform(options: JsonlTransformOptions) {
  const { onEvent } = options;

  const activeToolIds = new Set<string>();
  const taskToolIds = new Set<string>();
  let activityTimer: ReturnType<typeof setTimeout> | null = null;
  let lastActivityState: "active" | "idle" = "idle";

  function emitActivity(state: "active" | "idle") {
    if (lastActivityState === state) return;
    lastActivityState = state;
    onEvent({ type: "activity", state });
  }

  function resetActivityTimer() {
    if (activityTimer) clearTimeout(activityTimer);
    activityTimer = setTimeout(() => {
      emitActivity("idle");
    }, 5000);
  }

  /** Extract content blocks from a JSONL message field (array or {content: [...]}) */
  function extractContentBlocks(message: unknown): unknown[] | null {
    if (Array.isArray(message)) return message;
    if (message && typeof message === "object") {
      const content = (message as Record<string, unknown>).content;
      if (Array.isArray(content)) return content;
    }
    return null;
  }

  function handleEvent(data: unknown) {
    if (!data || typeof data !== "object") return;
    const record = data as Record<string, unknown>;

    if (record.type === "assistant") {
      const content = extractContentBlocks(record.message);
      if (content) { handleAssistantMessage(content); return; }
    }

    if (record.type === "user") {
      const content = extractContentBlocks(record.message);
      if (content) { handleUserMessage(content); return; }
    }

    // Progress events
    if (record.type === "progress") {
      emitActivity("active");
      resetActivityTimer();
      return;
    }

    // System events
    if (record.type === "system") {
      if (record.subtype === "turn_duration") {
        onEvent({ type: "turn:end" });
        emitActivity("idle");
        if (activityTimer) {
          clearTimeout(activityTimer);
          activityTimer = null;
        }
      }
      return;
    }
  }

  function handleAssistantMessage(content: unknown[]) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;

      if (b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string") {
        activeToolIds.add(b.id);
        emitActivity("active");
        resetActivityTimer();

        if (b.name === SUBAGENT_TOOL_NAME) {
          taskToolIds.add(b.id);
          const input = b.input as Record<string, unknown> | undefined;
          const description = typeof input?.description === "string" ? input.description : "";
          onEvent({
            type: "subagent:start",
            toolUseId: b.id,
            description,
          });
        } else {
          onEvent({
            type: "tool:start",
            toolUseId: b.id,
            toolName: b.name,
          });
        }
      }
    }
  }

  function handleUserMessage(content: unknown[]) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const b = block as Record<string, unknown>;

      if (b.type === "tool_result" && typeof b.tool_use_id === "string") {
        activeToolIds.delete(b.tool_use_id);

        if (taskToolIds.has(b.tool_use_id)) {
          taskToolIds.delete(b.tool_use_id);
          onEvent({
            type: "subagent:end",
            toolUseId: b.tool_use_id,
          });
        } else {
          onEvent({
            type: "tool:end",
            toolUseId: b.tool_use_id,
          });
        }
      }
    }
  }

  function stop() {
    if (activityTimer) {
      clearTimeout(activityTimer);
      activityTimer = null;
    }
  }

  return { handleEvent, stop };
}
