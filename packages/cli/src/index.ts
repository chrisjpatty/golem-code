#!/usr/bin/env bun

import { resolve, join } from "path";
import { existsSync } from "fs";
import { parseArgs } from "./args";
import { createSideChannelServer } from "./sideChannelServer";
import { spawnClaude, injectText, restoreTerminal, type PtyProcess } from "./ptySpawner";
import { discoverSessionFile } from "./sessionDiscovery";
import { watchJsonlFile, type JsonlWatcher } from "./jsonlWatcher";
import { createJsonlTransform } from "./jsonlTransform";

// When compiled with `bun build --compile`, import.meta.dirname is /$bunfs/root/
// so we resolve relative to the executable's real location instead.
const IS_COMPILED = import.meta.dirname.startsWith("/$bunfs");
const BASE_DIR = IS_COMPILED
  ? resolve(process.execPath, "..")
  : resolve(import.meta.dirname, "../..");

const FRONTEND_DIST = resolve(BASE_DIR, "packages/frontend/dist");

async function buildFrontend(): Promise<void> {
  const frontendDir = resolve(BASE_DIR, "packages/frontend");

  console.log("[summon] Building frontend...");
  const proc = Bun.spawn(["bun", "run", "build"], {
    cwd: frontendDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error("[summon] Frontend build failed:", stderr);
    process.exit(1);
  }
  console.log("[summon] Frontend built successfully.");
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];

  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }

  try {
    Bun.spawn([cmd, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch {
    // Silently fail if browser can't be opened
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    const pkg = await import("../package.json");
    console.log(`summon (golem-code) ${pkg.version}`);
    process.exit(0);
  }

  // Build frontend if dist doesn't exist
  if (!args.dev && !existsSync(join(FRONTEND_DIST, "index.html"))) {
    await buildFrontend();
  }

  if (!args.dev && !existsSync(join(FRONTEND_DIST, "index.html"))) {
    console.error(`[summon] Frontend not found at ${FRONTEND_DIST}. Run from the golem-code repo or use --dev mode.`);
    process.exit(1);
  }

  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();

  // Build Claude CLI args
  const claudeArgs: string[] = [];

  if (args.prompt) {
    claudeArgs.push("-p", args.prompt);
  }
  if (args.continue) {
    claudeArgs.push("--continue");
  }
  if (args.resume) {
    claudeArgs.push("--resume", args.resume);
  }
  if (args.passthroughArgs) {
    claudeArgs.push(...args.passthroughArgs);
  }

  // Track PTY process and watcher for cleanup
  let ptyProc: PtyProcess | null = null;
  let jsonlWatcher: JsonlWatcher | null = null;
  let jsonlTransform: ReturnType<typeof createJsonlTransform> | null = null;

  // Start side-channel server
  const server = createSideChannelServer({
    port: args.port,
    ...(args.dev ? {} : { staticDir: FRONTEND_DIST }),
    onInject: (text) => {
      if (ptyProc) {
        injectText(ptyProc, text);
      }
    },
  });

  const url = `http://localhost:${server.port}`;
  console.log(`[summon] Golem server: ${url}`);

  if (args.dev) {
    console.log(`[summon] Dev mode: start the frontend separately with "cd packages/frontend && bun run dev"`);
  }

  if (!args.noOpen && !args.dev) {
    openBrowser(url);
  }

  // Ensure cleanup on exit
  function cleanup(code: number) {
    jsonlWatcher?.stop();
    jsonlTransform?.stop();
    server.stop();
    restoreTerminal();
    process.exit(code);
  }

  process.on("exit", () => {
    restoreTerminal();
  });

  // Spawn Claude Code in PTY — after this point, stdout belongs to the PTY.
  // No more console.log/warn/error or it will corrupt the TUI.
  ptyProc = spawnClaude(claudeArgs, cwd);

  // Discover JSONL session file (silently — PTY owns the terminal now)
  try {
    const sessionFile = await discoverSessionFile({
      cwd,
      continueOrResume: !!(args.continue || args.resume),
    });

    jsonlTransform = createJsonlTransform({
      onEvent: (event) => {
        server.broadcast(event);
      },
    });

    jsonlWatcher = watchJsonlFile(sessionFile, {
      onEvent: (data) => {
        jsonlTransform!.handleEvent(data);
      },
    });
  } catch {
    // Session discovery failed — face won't react, but Claude still works fine
  }

  // Wait for PTY to exit
  const exitCode = await ptyProc.exited;
  cleanup(exitCode);
}

function printHelp() {
  console.log(`
summon - Launch Claude Code with the Golem ambient companion

Usage:
  summon [options] [prompt]

Options:
  -p, --prompt <text>           Initial prompt (forwarded to Claude via -p)
  -c, --continue                Continue the most recent conversation
  -r, --resume <session-id>     Resume a specific session
  --cwd <dir>                   Working directory (default: current directory)
  --port <port>                 Golem server port (default: 4747)
  --no-open                     Don't auto-open the browser
  --dev                         Dev mode: skip frontend build and static serving
  -v, --version                 Show version
  -h, --help                    Show this help

  --                            Pass remaining args directly to Claude Code

Examples:
  summon                            Launch Claude Code with Golem face
  summon "Fix the failing tests"    Launch with an initial prompt
  summon -c                         Continue most recent conversation
  summon --cwd ~/my-project         Launch in a specific directory
  summon -- --model sonnet          Pass --model to Claude directly
`.trim());
}

main().catch((err) => {
  restoreTerminal();
  console.error("[summon] Fatal error:", err);
  process.exit(1);
});
