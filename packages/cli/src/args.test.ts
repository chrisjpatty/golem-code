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

  // -- Model --

  test("-m sets model", () => {
    expect(parseArgs(["-m", "claude-sonnet-4-5-20250929"]).model).toBe("claude-sonnet-4-5-20250929");
  });

  test("--model sets model", () => {
    expect(parseArgs(["--model", "claude-opus-4-20250514"]).model).toBe("claude-opus-4-20250514");
  });

  // -- Permission mode --

  test("--permission-mode sets valid mode", () => {
    expect(parseArgs(["--permission-mode", "acceptEdits"]).permissionMode).toBe("acceptEdits");
  });

  test("--permission-mode accepts all valid modes", () => {
    const modes = ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"] as const;
    for (const mode of modes) {
      expect(parseArgs(["--permission-mode", mode]).permissionMode).toBe(mode);
    }
  });

  // -- Numeric options --

  test("--max-turns parses integer", () => {
    expect(parseArgs(["--max-turns", "10"]).maxTurns).toBe(10);
  });

  test("--max-budget-usd parses float", () => {
    expect(parseArgs(["--max-budget-usd", "5.50"]).maxBudgetUsd).toBe(5.50);
  });

  test("--port parses integer", () => {
    expect(parseArgs(["--port", "8080"]).port).toBe(8080);
  });

  // -- String options --

  test("--system-prompt sets system prompt", () => {
    expect(parseArgs(["--system-prompt", "You are a code reviewer"]).systemPrompt).toBe("You are a code reviewer");
  });

  test("--cwd sets working directory", () => {
    expect(parseArgs(["--cwd", "/tmp/myproject"]).cwd).toBe("/tmp/myproject");
  });

  test("--resume sets session ID", () => {
    expect(parseArgs(["--resume", "abc-123"]).resume).toBe("abc-123");
  });

  test("-r sets session ID", () => {
    expect(parseArgs(["-r", "abc-123"]).resume).toBe("abc-123");
  });

  // -- List options --

  test("--allowed-tools parses comma-separated list", () => {
    expect(parseArgs(["--allowed-tools", "Bash,Read,Edit"]).allowedTools).toEqual(["Bash", "Read", "Edit"]);
  });

  test("--allowed-tools trims whitespace", () => {
    expect(parseArgs(["--allowed-tools", "Bash , Read , Edit"]).allowedTools).toEqual(["Bash", "Read", "Edit"]);
  });

  test("--disallowed-tools parses comma-separated list", () => {
    expect(parseArgs(["--disallowed-tools", "Write,Bash"]).disallowedTools).toEqual(["Write", "Bash"]);
  });

  test("--add-dir accumulates multiple directories", () => {
    const result = parseArgs(["--add-dir", "/tmp/a", "--add-dir", "/tmp/b"]);
    expect(result.additionalDirectories).toEqual(["/tmp/a", "/tmp/b"]);
  });

  // -- Boolean flags --

  test("-c sets continue flag", () => {
    expect(parseArgs(["-c"]).continue).toBe(true);
  });

  test("--continue sets continue flag", () => {
    expect(parseArgs(["--continue"]).continue).toBe(true);
  });

  test("--debug sets debug flag", () => {
    expect(parseArgs(["--debug"]).debug).toBe(true);
  });

  test("--no-open sets noOpen flag", () => {
    expect(parseArgs(["--no-open"]).noOpen).toBe(true);
  });

  test("--dev sets dev flag", () => {
    expect(parseArgs(["--dev"]).dev).toBe(true);
  });

  // -- Empty input --

  test("empty args returns empty result", () => {
    const result = parseArgs([]);
    expect(result.prompt).toBeUndefined();
    expect(result.model).toBeUndefined();
    expect(result.help).toBeUndefined();
    expect(result.debug).toBeUndefined();
    expect(result.port).toBeUndefined();
  });

  // -- Combined flags --

  test("multiple flags can be combined", () => {
    const result = parseArgs([
      "-m", "claude-opus-4-20250514",
      "--port", "9090",
      "--debug",
      "--no-open",
      "-c",
      "--cwd", "/tmp/project",
      "Fix the bug",
    ]);
    expect(result.model).toBe("claude-opus-4-20250514");
    expect(result.port).toBe(9090);
    expect(result.debug).toBe(true);
    expect(result.noOpen).toBe(true);
    expect(result.continue).toBe(true);
    expect(result.cwd).toBe("/tmp/project");
    expect(result.prompt).toBe("Fix the bug");
  });

  test("flags before and after positional prompt", () => {
    const result = parseArgs(["--debug", "my prompt", "--dev"]);
    expect(result.debug).toBe(true);
    expect(result.dev).toBe(true);
    expect(result.prompt).toBe("my prompt");
  });

  // -- Defaults --

  test("undefined fields are not set (no false defaults)", () => {
    const result = parseArgs(["hello"]);
    expect(result.prompt).toBe("hello");
    expect("debug" in result).toBe(false);
    expect("continue" in result).toBe(false);
    expect("noOpen" in result).toBe(false);
    expect("dev" in result).toBe(false);
    expect("model" in result).toBe(false);
  });

  // -- NaN validation --

  test("--max-turns rejects non-integer value", () => {
    mockProcessExit();
    try {
      expect(() => parseArgs(["--max-turns", "foo"])).toThrow();
    } finally {
      restoreProcessExit();
    }
  });

  test("--port rejects non-integer value", () => {
    mockProcessExit();
    try {
      expect(() => parseArgs(["--port", "abc"])).toThrow();
    } finally {
      restoreProcessExit();
    }
  });

  test("--max-budget-usd rejects non-numeric value", () => {
    mockProcessExit();
    try {
      expect(() => parseArgs(["--max-budget-usd", "xyz"])).toThrow();
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
});
