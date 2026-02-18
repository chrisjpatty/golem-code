/**
 * Pure utility functions for processing tool inputs and results.
 * Extracted to a separate file so they can be unit-tested without React dependencies.
 */

/** Summarize tool input into a short one-liner for display. */
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

/**
 * Truncate tool result to a displayable string.
 * Tool result `content` from the Anthropic API can be a plain string
 * OR an array of content blocks like [{type:"text", text:"..."}].
 */
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
