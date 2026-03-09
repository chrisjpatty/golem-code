/**
 * Spawns Claude Code in a PTY with bidirectional I/O.
 * Forwards terminal input/output and handles resize.
 */

import type { Subprocess } from "bun";

export type PtyProcess = Subprocess & {
  readonly terminal: {
    write(data: string | Uint8Array): void;
    resize(cols: number, rows: number): void;
  };
};

export function spawnClaude(args: string[], cwd: string): PtyProcess {
  const proc = Bun.spawn(["claude", ...args], {
    cwd,
    terminal: {
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      data(_terminal: any, data: Buffer) {
        process.stdout.write(data);
      },
    },
    env: { ...process.env },
  }) as PtyProcess;

  // Forward real stdin to PTY in raw mode for immediate key pass-through
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.on("data", (chunk: Buffer) => {
    proc.terminal.write(chunk);
  });

  // Handle terminal resize
  process.on("SIGWINCH", () => {
    proc.terminal.resize(
      process.stdout.columns || 80,
      process.stdout.rows || 24,
    );
  });

  return proc;
}

/** Inject text into the PTY as if typed, followed by Enter */
export function injectText(proc: PtyProcess, text: string): void {
  proc.terminal.write(text + "\r");
}

/** Restore terminal state on exit */
export function restoreTerminal(): void {
  try {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  } catch {
    // May fail if stdin is already closed
  }
}
