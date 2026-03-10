/**
 * Transforms Claude Code hook event payloads into GolemEvents.
 *
 * Hook events arrive as POST bodies from the Claude Code plugin:
 *   - PreToolUse:    { hook_event_name, tool_name, tool_input }
 *   - PostToolUse:   { hook_event_name, tool_name, tool_input, tool_output }
 *   - SubagentStart: { hook_event_name, agent_id, agent_type }
 *   - SubagentStop:  { hook_event_name, agent_id, agent_type }
 *   - Stop:          { hook_event_name }
 */

import type { GolemEvent } from "@golem-code/types";

const SUBAGENT_TOOL_NAME = "Task";

export type HookTransformOptions = {
  agentId: string;
  onEvent: (event: GolemEvent) => void;
};

export function createHookTransform(options: HookTransformOptions) {
  const { agentId, onEvent } = options;

  // Track tool IDs so we can pair PreToolUse with PostToolUse.
  // Hook events don't have a toolUseId, so we generate one per PreToolUse
  // keyed by tool_name to handle sequential tool calls.
  const pendingTools = new Map<string, string[]>();

  function handleHookEvent(data: Record<string, unknown>) {
    const eventName = data.hook_event_name as string;

    switch (eventName) {
      case "PreToolUse": {
        const toolName = data.tool_name as string;
        const toolUseId = crypto.randomUUID();

        // Track this tool use for pairing with PostToolUse
        if (!pendingTools.has(toolName)) {
          pendingTools.set(toolName, []);
        }
        pendingTools.get(toolName)!.push(toolUseId);

        if (toolName === SUBAGENT_TOOL_NAME || toolName === "Agent") {
          const input = data.tool_input as Record<string, unknown> | undefined;
          const description =
            typeof input?.description === "string"
              ? input.description
              : typeof input?.prompt === "string"
                ? (input.prompt as string).slice(0, 100)
                : "";
          onEvent({
            type: "subagent:start",
            agentId,
            toolUseId,
            description,
          });
        } else {
          onEvent({
            type: "tool:start",
            agentId,
            toolUseId,
            toolName,
          });
        }

        onEvent({ type: "activity", agentId, state: "active" });
        break;
      }

      case "PostToolUse":
      case "PostToolUseFailure": {
        const toolName = data.tool_name as string;
        const queue = pendingTools.get(toolName);
        const toolUseId = queue?.shift() ?? crypto.randomUUID();
        if (queue?.length === 0) pendingTools.delete(toolName);

        if (toolName === SUBAGENT_TOOL_NAME || toolName === "Agent") {
          onEvent({ type: "subagent:end", agentId, toolUseId });
        } else {
          onEvent({ type: "tool:end", agentId, toolUseId });
        }
        break;
      }

      case "SubagentStart": {
        const subagentId = data.agent_id as string;
        const agentType = (data.agent_type as string) ?? "";
        onEvent({
          type: "subagent:start",
          agentId,
          toolUseId: subagentId,
          description: agentType,
        });
        onEvent({ type: "activity", agentId, state: "active" });
        break;
      }

      case "SubagentStop": {
        const subagentId = data.agent_id as string;
        onEvent({ type: "subagent:end", agentId, toolUseId: subagentId });
        break;
      }

      case "PermissionRequest": {
        const toolName = (data.tool_name as string) ?? "";
        onEvent({ type: "permission:request", agentId, toolName });
        break;
      }

      case "Stop": {
        onEvent({ type: "turn:end", agentId });
        onEvent({ type: "activity", agentId, state: "idle" });
        break;
      }
    }
  }

  return { handleHookEvent };
}
