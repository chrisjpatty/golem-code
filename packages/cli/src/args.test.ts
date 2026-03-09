import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { parseArgs } from "./args";

// Mock process.exit to throw instead of terminating the process
const originalExit = process.exit;
function mockProcessExit() {
  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never;
}
function restoreProcessExit() {
  process.exit = originalExit;
}

describe("parseArgs", () => {
  // -- Help & version flags --

  test("--help sets help flag", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
  });

  test("-h sets help flag", () => {
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  test("--version sets version flag", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
  });

  test("-v sets version flag", () => {
    expect(parseArgs(["-v"]).version).toBe(true);
  });

  // -- Positional prompt --

  test("positional argument becomes prompt", () => {
    expect(parseArgs(["Fix the tests"]).prompt).toBe("Fix the tests");
  });

  test("multiple positional words are joined into a single prompt", () => {
    expect(parseArgs(["Fix", "the", "tests"]).prompt).toBe("Fix the tests");
  });

  test("quoted positional argument becomes prompt", () => {
    expect(parseArgs(["Fix the failing tests"]).prompt).toBe("Fix the failing tests");
  });

  // -- Prompt flag --

  test("-p sets prompt", () => {
    expect(parseArgs(["-p", "hello world"]).prompt).toBe("hello world");
  });

  test("--prompt sets prompt", () => {
    expect(parseArgs(["--prompt", "hello world"]).prompt).toBe("hello world");
  });

  test("-p takes precedence over positional arguments", () => {
    const result = parseArgs(["-p", "flag prompt", "positional"]);
    expect(result.prompt).toBe("flag prompt");
  });

  // -- Numeric options --

  test("--port parses integer", () => {
    expect(parseArgs(["--port", "8080"]).port).toBe(8080);
  });

  // -- String options --

  test("--cwd sets working directory", () => {
    expect(parseArgs(["--cwd", "/tmp/myproject"]).cwd).toBe("/tmp/myproject");
  });

  test("--resume sets session ID", () => {
    expect(parseArgs(["--resume", "abc-123"]).resume).toBe("abc-123");
  });

  test("-r sets session ID", () => {
    expect(parseArgs(["-r", "abc-123"]).resume).toBe("abc-123");
  });

  // -- Boolean flags --

  test("-c sets continue flag", () => {
    expect(parseArgs(["-c"]).continue).toBe(true);
  });

  test("--continue sets continue flag", () => {
    expect(parseArgs(["--continue"]).continue).toBe(true);
  });

  test("--no-open sets noOpen flag", () => {
    expect(parseArgs(["--no-open"]).noOpen).toBe(true);
  });

  test("--dev sets dev flag", () => {
    expect(parseArgs(["--dev"]).dev).toBe(true);
  });

  // -- Passthrough args --

  test("-- captures remaining args as passthroughArgs", () => {
    const result = parseArgs(["--port", "9090", "--", "--model", "sonnet", "--debug"]);
    expect(result.port).toBe(9090);
    expect(result.passthroughArgs).toEqual(["--model", "sonnet", "--debug"]);
  });

  test("-- with no remaining args gives empty array", () => {
    const result = parseArgs(["--"]);
    expect(result.passthroughArgs).toEqual([]);
  });

  // -- Empty input --

  test("empty args returns empty result", () => {
    const result = parseArgs([]);
    expect(result.prompt).toBeUndefined();
    expect(result.help).toBeUndefined();
    expect(result.port).toBeUndefined();
  });

  // -- Combined flags --

  test("multiple flags can be combined", () => {
    const result = parseArgs([
      "--port", "9090",
      "--no-open",
      "-c",
      "--cwd", "/tmp/project",
      "Fix the bug",
    ]);
    expect(result.port).toBe(9090);
    expect(result.noOpen).toBe(true);
    expect(result.continue).toBe(true);
    expect(result.cwd).toBe("/tmp/project");
    expect(result.prompt).toBe("Fix the bug");
  });

  test("flags before and after positional prompt", () => {
    const result = parseArgs(["--dev", "my prompt", "--no-open"]);
    expect(result.dev).toBe(true);
    expect(result.noOpen).toBe(true);
    expect(result.prompt).toBe("my prompt");
  });

  // -- Defaults --

  test("undefined fields are not set (no false defaults)", () => {
    const result = parseArgs(["hello"]);
    expect(result.prompt).toBe("hello");
    expect("continue" in result).toBe(false);
    expect("noOpen" in result).toBe(false);
    expect("dev" in result).toBe(false);
  });

  // -- NaN validation --

  test("--port rejects non-integer value", () => {
    mockProcessExit();
    try {
      expect(() => parseArgs(["--port", "abc"])).toThrow();
    } finally {
      restoreProcessExit();
    }
  });

  // -- Mutual exclusivity --

  test("--continue and --resume cannot be used together", () => {
    mockProcessExit();
    try {
      expect(() => parseArgs(["--continue", "--resume", "abc-123"])).toThrow();
    } finally {
      restoreProcessExit();
    }
  });

  // -- Unknown flags --

  test("unknown flags cause an error", () => {
    mockProcessExit();
    try {
      expect(() => parseArgs(["--permission-mode", "default"])).toThrow();
    } finally {
      restoreProcessExit();
    }
  });
});
