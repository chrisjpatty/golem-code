import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { GolemEvent } from "@golem-code/types";

/**
 * Transforms a raw SDK message into zero or more GolemEvents
 * for the frontend to visualize.
 */
export function sdkMessageToGolemEvents(msg: SDKMessage): GolemEvent[] {
  const now = Date.now();

  switch (msg.type) {
    // -- System init --
    case "system": {
      if (msg.subtype === "init") {
        return [
          {
            type: "session:init",
            sessionId: msg.session_id,
            model: msg.model,
            tools: msg.tools,
            cwd: msg.cwd,
            timestamp: now,
          },
        ];
      }
      if (msg.subtype === "task_notification") {
        return [
          {
            type: "subagent:complete",
            taskId: msg.task_id,
            status: msg.status,
            summary: msg.summary,
            timestamp: now,
          },
        ];
      }
      return [];
    }

    // -- Full assistant message (contains tool_use blocks + text) --
    case "assistant": {
      const events: GolemEvent[] = [];
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          events.push({
            type: "tool:start",
            toolUseId: block.id,
            toolName: block.name,
            input: block.input as Record<string, unknown>,
            parentToolUseId: msg.parent_tool_use_id,
            timestamp: now,
          });
        }
      }
      return events;
    }

    // -- Streaming deltas --
    case "stream_event": {
      const evt = msg.event;
      if (evt.type === "content_block_delta") {
        if (evt.delta.type === "text_delta") {
          return [
            {
              type: "text:delta",
              text: evt.delta.text,
              timestamp: now,
            },
          ];
        }
        if (evt.delta.type === "thinking_delta") {
          return [
            {
              type: "thinking:delta",
              text: evt.delta.thinking,
              timestamp: now,
            },
          ];
        }
      }
      return [];
    }

    // -- Tool progress heartbeats --
    case "tool_progress": {
      return [
        {
          type: "tool:progress",
          toolUseId: msg.tool_use_id,
          toolName: msg.tool_name,
          elapsedSeconds: msg.elapsed_time_seconds,
          timestamp: now,
        },
      ];
    }

    // -- User messages (contain tool results) --
    case "user": {
      const events: GolemEvent[] = [];
      const content = msg.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            block.type === "tool_result"
          ) {
            events.push({
              type: "tool:result",
              toolUseId: (block as any).tool_use_id,
              result: (block as any).content,
              timestamp: now,
            });
          }
        }
      }
      return events;
    }

    // -- Final result --
    case "result": {
      return [
        {
          type: "session:result",
          sessionId: msg.session_id,
          success: msg.subtype === "success",
          result: msg.subtype === "success" ? msg.result : undefined,
          errors: msg.subtype !== "success" ? msg.errors : undefined,
          durationMs: msg.duration_ms,
          totalCostUsd: msg.total_cost_usd,
          inputTokens: msg.usage.input_tokens,
          outputTokens: msg.usage.output_tokens,
          numTurns: msg.num_turns,
          timestamp: now,
        },
      ];
    }

    default:
      return [];
  }
}
