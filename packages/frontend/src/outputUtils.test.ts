import { describe, test, expect } from "bun:test";
import { summarizeToolInput, formatToolResult } from "./outputUtils";

describe("summarizeToolInput", () => {
  test("Read tool returns file_path", () => {
    expect(summarizeToolInput("Read", { file_path: "/src/index.ts" })).toBe("/src/index.ts");
  });

  test("Write tool returns file_path", () => {
    expect(summarizeToolInput("Write", { file_path: "/out/build.js" })).toBe("/out/build.js");
  });

  test("Edit tool returns file_path", () => {
    expect(summarizeToolInput("Edit", { file_path: "/a.ts", old_string: "x", new_string: "y" })).toBe("/a.ts");
  });

  test("Bash tool returns command truncated to 120 chars", () => {
    const short = "echo hello";
    expect(summarizeToolInput("Bash", { command: short })).toBe(short);

    const long = "a".repeat(200);
    expect(summarizeToolInput("Bash", { command: long })).toBe("a".repeat(120));
  });

  test("Grep tool returns pattern and path", () => {
    expect(summarizeToolInput("Grep", { pattern: "TODO", path: "src/" })).toBe("/TODO/ src/");
  });

  test("Glob tool returns pattern and path", () => {
    expect(summarizeToolInput("Glob", { pattern: "**/*.ts", path: "." })).toBe("**/*.ts .");
  });

  test("Task tool returns description", () => {
    expect(summarizeToolInput("Task", { description: "Run tests" })).toBe("Run tests");
  });

  test("unknown tool with string first value returns it", () => {
    expect(summarizeToolInput("CustomTool", { query: "hello world" })).toBe("hello world");
  });

  test("unknown tool with non-string first value returns JSON", () => {
    expect(summarizeToolInput("CustomTool", { count: 42 })).toBe("42");
  });

  test("unknown tool with empty input returns empty string", () => {
    expect(summarizeToolInput("CustomTool", {})).toBe("");
  });

  test("missing fields return empty string gracefully", () => {
    expect(summarizeToolInput("Read", {})).toBe("");
    expect(summarizeToolInput("Bash", {})).toBe("");
    expect(summarizeToolInput("Task", {})).toBe("");
  });
});

describe("formatToolResult", () => {
  test("null returns empty string", () => {
    expect(formatToolResult(null)).toBe("");
  });

  test("undefined returns empty string", () => {
    expect(formatToolResult(undefined)).toBe("");
  });

  test("plain string is returned as-is", () => {
    expect(formatToolResult("hello world")).toBe("hello world");
  });

  test("content block array extracts text", () => {
    const blocks = [
      { type: "text", text: "line one" },
      { type: "text", text: "line two" },
    ];
    expect(formatToolResult(blocks)).toBe("line one\nline two");
  });

  test("content block array shows placeholder for non-text blocks", () => {
    const blocks = [
      { type: "image", url: "https://example.com/img.png" },
      { type: "text", text: "visible" },
    ];
    expect(formatToolResult(blocks)).toBe("[image]\nvisible");
  });

  test("array with no text blocks shows placeholders", () => {
    const blocks = [{ type: "image", url: "x" }];
    expect(formatToolResult(blocks)).toBe("[image]");
  });

  test("tool_use_error XML tags are cleaned", () => {
    expect(formatToolResult("<tool_use_error>Sibling tool call errored</tool_use_error>")).toBe(
      "Error: Sibling tool call errored",
    );
  });

  test("generic XML wrapper tags are stripped", () => {
    expect(formatToolResult("<result>some content</result>")).toBe("some content");
  });

  test("tool_result content block recurses", () => {
    const block = { type: "tool_result", content: [{ type: "text", text: "inner" }] };
    expect(formatToolResult([block])).toBe("inner");
  });

  test("object is JSON-stringified", () => {
    const obj = { key: "value" };
    expect(formatToolResult(obj)).toBe(JSON.stringify(obj, null, 2));
  });

  test("number is JSON-stringified", () => {
    expect(formatToolResult(42)).toBe("42");
  });

  test("empty array falls through to JSON", () => {
    expect(formatToolResult([])).toBe("[]");
  });
});
