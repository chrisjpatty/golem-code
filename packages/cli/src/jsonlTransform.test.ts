import { describe, test, expect } from "bun:test";
import type { GolemEvent } from "@golem-code/types";
import { createJsonlTransform } from "./jsonlTransform";

function collectEvents(records: unknown[]): GolemEvent[] {
  const events: GolemEvent[] = [];
  const transform = createJsonlTransform({
    onEvent: (e) => events.push(e),
  });
  for (const r of records) {
    transform.handleEvent(r);
  }
  transform.stop();
  return events;
}

describe("jsonlTransform", () => {
  test("tool_use in assistant message emits tool:start", () => {
    const events = collectEvents([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu_1", name: "Read", input: { file_path: "/foo" } },
          ],
        },
      },
    ]);

    expect(events).toEqual([
      { type: "activity", state: "active" },
      { type: "tool:start", toolUseId: "tu_1", toolName: "Read" },
    ]);
  });

  test("tool_result in user message emits tool:end", () => {
    const events = collectEvents([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu_2", name: "Bash", input: {} },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu_2", content: "done" },
          ],
        },
      },
    ]);

    expect(events[events.length - 1]).toEqual({
      type: "tool:end",
      toolUseId: "tu_2",
    });
  });

  test("Task tool_use emits subagent:start and subagent:end", () => {
    const events = collectEvents([
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "tu_task",
              name: "Task",
              input: { description: "Search for tests" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: "tu_task", content: "found 3 tests" },
          ],
        },
      },
    ]);

    const starts = events.filter((e) => e.type === "subagent:start");
    const ends = events.filter((e) => e.type === "subagent:end");

    expect(starts).toHaveLength(1);
    expect(starts[0]).toEqual({
      type: "subagent:start",
      toolUseId: "tu_task",
      description: "Search for tests",
    });

    expect(ends).toHaveLength(1);
    expect(ends[0]).toEqual({
      type: "subagent:end",
      toolUseId: "tu_task",
    });
  });

  test("system turn_duration emits turn:end and activity idle", () => {
    // First make it active so the idle transition actually fires
    const events = collectEvents([
      { type: "progress", data: {} },
      { type: "system", subtype: "turn_duration", durationMs: 5000 },
    ]);

    expect(events).toEqual([
      { type: "activity", state: "active" },
      { type: "turn:end" },
      { type: "activity", state: "idle" },
    ]);
  });

  test("progress events emit activity active", () => {
    const events = collectEvents([
      { type: "progress", data: {} },
    ]);

    expect(events).toEqual([
      { type: "activity", state: "active" },
    ]);
  });

  test("ignores unknown event types", () => {
    const events = collectEvents([
      { type: "unknown", data: "stuff" },
      null,
      42,
      "string",
    ]);

    expect(events).toEqual([]);
  });

  test("multiple tool_use blocks in one assistant message", () => {
    const events = collectEvents([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tu_a", name: "Read", input: {} },
            { type: "tool_use", id: "tu_b", name: "Grep", input: {} },
          ],
        },
      },
    ]);

    const toolStarts = events.filter((e) => e.type === "tool:start");
    expect(toolStarts).toHaveLength(2);
    expect(toolStarts[0]).toEqual({ type: "tool:start", toolUseId: "tu_a", toolName: "Read" });
    expect(toolStarts[1]).toEqual({ type: "tool:start", toolUseId: "tu_b", toolName: "Grep" });
  });
});
