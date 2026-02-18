import { describe, test, expect, mock } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { UUID } from "crypto";
import { sdkMessageToGolemEvents } from "./transform";

const SESSION_ID = "test-session-id";
const UUID_1 = "00000000-0000-0000-0000-000000000001" as UUID;

describe("sdkMessageToGolemEvents", () => {
  // -- system init --
  test("transforms system init message", () => {
    const msg: SDKMessage = {
      type: "system",
      subtype: "init",
      session_id: SESSION_ID,
      model: "claude-sonnet-4-5-20250929",
      tools: ["Read", "Bash"],
      cwd: "/home/user",
      apiKeySource: "user",
      claude_code_version: "1.0.0",
      mcp_servers: [],
      permissionMode: "default",
      slash_commands: [],
      output_style: "text",
      skills: [],
      plugins: [],
      uuid: UUID_1,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "session:init",
      sessionId: SESSION_ID,
      model: "claude-sonnet-4-5-20250929",
      tools: ["Read", "Bash"],
      cwd: "/home/user",
    });
    expect(events[0].timestamp).toBeGreaterThan(0);
  });

  // -- system task_notification --
  test("transforms task_notification into subagent:complete", () => {
    const msg: SDKMessage = {
      type: "system",
      subtype: "task_notification",
      task_id: "task-123",
      status: "completed",
      summary: "Task finished successfully",
      output_file: "/tmp/output",
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "subagent:complete",
      taskId: "task-123",
      status: "completed",
      summary: "Task finished successfully",
    });
  });

  // -- system status --
  test("transforms system status into status:update", () => {
    const msg: SDKMessage = {
      type: "system",
      subtype: "status",
      status: "compacting",
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "status:update",
      status: "compacting",
    });
  });

  // -- assistant with tool_use --
  test("transforms assistant message tool_use blocks into tool:start events", () => {
    const msg: SDKMessage = {
      type: "assistant",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "Bash",
            input: { command: "ls" },
          },
          {
            type: "tool_use",
            id: "tool-2",
            name: "Read",
            input: { file_path: "/tmp/foo" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      } as any,
      parent_tool_use_id: null,
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "tool:start",
      toolUseId: "tool-1",
      toolName: "Bash",
      input: { command: "ls" },
      parentToolUseId: null,
    });
    expect(events[1]).toMatchObject({
      type: "tool:start",
      toolUseId: "tool-2",
      toolName: "Read",
      input: { file_path: "/tmp/foo" },
    });
  });

  test("propagates parent_tool_use_id for subagent tool calls", () => {
    const msg: SDKMessage = {
      type: "assistant",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: [
          { type: "tool_use", id: "tool-3", name: "Grep", input: { pattern: "foo" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      } as any,
      parent_tool_use_id: "parent-task-id",
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events[0]).toMatchObject({
      parentToolUseId: "parent-task-id",
    });
  });

  test("returns empty for assistant messages with only text content", () => {
    const msg: SDKMessage = {
      type: "assistant",
      message: {
        id: "msg-1",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: [{ type: "text", text: "Hello!" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      } as any,
      parent_tool_use_id: null,
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(0);
  });

  // -- stream_event text_delta --
  test("transforms text_delta stream event", () => {
    const msg: SDKMessage = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello world" },
      } as any,
      parent_tool_use_id: null,
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "text:delta",
      text: "Hello world",
    });
  });

  // -- stream_event thinking_delta --
  test("transforms thinking_delta stream event", () => {
    const msg: SDKMessage = {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me think..." },
      } as any,
      parent_tool_use_id: null,
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "thinking:delta",
      text: "Let me think...",
    });
  });

  // -- stream_event we ignore --
  test("returns empty for non-delta stream events", () => {
    const msg: SDKMessage = {
      type: "stream_event",
      event: {
        type: "message_start",
        message: {} as any,
      } as any,
      parent_tool_use_id: null,
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(0);
  });

  // -- tool_progress --
  test("transforms tool_progress message", () => {
    const msg: SDKMessage = {
      type: "tool_progress",
      tool_use_id: "tool-1",
      tool_name: "Bash",
      parent_tool_use_id: null,
      elapsed_time_seconds: 5.2,
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool:progress",
      toolUseId: "tool-1",
      toolName: "Bash",
      elapsedSeconds: 5.2,
    });
  });

  // -- user message with tool_result --
  test("transforms user message with tool_result blocks", () => {
    const msg: SDKMessage = {
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tool-1",
            content: "file contents here",
          },
          {
            type: "tool_result",
            tool_use_id: "tool-2",
            content: "grep results",
          },
        ],
      },
      parent_tool_use_id: null,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: "tool:result",
      toolUseId: "tool-1",
      result: "file contents here",
    });
    expect(events[1]).toMatchObject({
      type: "tool:result",
      toolUseId: "tool-2",
      result: "grep results",
    });
  });

  test("returns empty for user messages with plain text content", () => {
    const msg: SDKMessage = {
      type: "user",
      message: {
        role: "user",
        content: "Hello",
      },
      parent_tool_use_id: null,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(0);
  });

  // -- result success --
  test("transforms result success message", () => {
    const msg: SDKMessage = {
      type: "result",
      subtype: "success",
      session_id: SESSION_ID,
      is_error: false,
      result: "Done!",
      duration_ms: 5000,
      duration_api_ms: 4500,
      total_cost_usd: 0.05,
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      num_turns: 3,
      stop_reason: "end_turn",
      permission_denials: [],
      uuid: UUID_1,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "session:result",
      sessionId: SESSION_ID,
      success: true,
      result: "Done!",
      durationMs: 5000,
      totalCostUsd: 0.05,
      inputTokens: 100,
      outputTokens: 200,
      numTurns: 3,
    });
    expect((events[0] as any).errors).toBeUndefined();
  });

  // -- result error --
  test("transforms result error message", () => {
    const msg: SDKMessage = {
      type: "result",
      subtype: "error_during_execution",
      session_id: SESSION_ID,
      is_error: true,
      errors: ["Something went wrong"],
      duration_ms: 2000,
      duration_api_ms: 1500,
      total_cost_usd: 0.02,
      usage: {
        input_tokens: 50,
        output_tokens: 10,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      modelUsage: {},
      num_turns: 1,
      stop_reason: null,
      permission_denials: [],
      uuid: UUID_1,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "session:result",
      success: false,
      errors: ["Something went wrong"],
    });
    expect((events[0] as any).result).toBeUndefined();
  });

  // -- unhandled message types --
  test("returns empty for auth_status messages", () => {
    const msg: SDKMessage = {
      type: "auth_status",
      isAuthenticating: true,
      output: [],
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(0);
  });

  test("transforms tool_use_summary into tool:summary", () => {
    const msg: SDKMessage = {
      type: "tool_use_summary",
      summary: "Used Bash to list files",
      preceding_tool_use_ids: ["tool-1"],
      uuid: UUID_1,
      session_id: SESSION_ID,
    };

    const events = sdkMessageToGolemEvents(msg);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool:summary",
      summary: "Used Bash to list files",
      toolUseIds: ["tool-1"],
    });
  });
});
