/**
 * Pure utility functions for processing tool inputs and results.
 * Extracted to a separate file so they can be unit-tested without React dependencies.
 */

/** Tools whose results are typically verbose and should start collapsed. */
export const COLLAPSED_RESULT_TOOLS = new Set([
  "WebFetch",
  "WebSearch",
]);

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
 * Strip known XML wrapper tags from tool result text.
 * - `<tool_use_error>msg</tool_use_error>` → "Error: msg"
 * - Other `<tag>content</tag>` wrappers → content only
 */
function cleanXmlTags(text: string): string {
  // Handle tool_use_error specifically — prefix with "Error: "
  text = text.replace(/<tool_use_error>([\s\S]*?)<\/tool_use_error>/g, (_match, inner) => `Error: ${inner.trim()}`);
  // Strip other common XML wrapper tags (single top-level tags wrapping content)
  text = text.replace(/^<([a-zA-Z_][\w-]*)>([\s\S]*)<\/\1>$/g, (_match, _tag, inner) => inner.trim());
  return text;
}

/**
 * Format a single content block from a tool result.
 */
function formatContentBlock(block: unknown): string | null {
  if (typeof block !== "object" || block === null) return null;
  const b = block as Record<string, unknown>;
  if (b.type === "text" && typeof b.text === "string") return b.text;
  if (b.type === "tool_result" && b.content != null) return formatToolResult(b.content);
  if (typeof b.type === "string") return `[${b.type}]`;
  return null;
}

/**
 * Truncate tool result to a displayable string.
 * Tool result `content` from the Anthropic API can be a plain string
 * OR an array of content blocks like [{type:"text", text:"..."}].
 */
export function formatToolResult(result: unknown): string {
  if (result === null || result === undefined) return "";
  if (typeof result === "string") return cleanXmlTags(result);
  if (Array.isArray(result)) {
    const parts: string[] = [];
    for (const block of result) {
      const text = formatContentBlock(block);
      if (text != null) parts.push(text);
    }
    if (parts.length > 0) return cleanXmlTags(parts.join("\n"));
  }
  return JSON.stringify(result, null, 2);
}
