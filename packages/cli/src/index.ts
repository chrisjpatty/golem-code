#!/usr/bin/env bun

import { resolve, join } from "path";
import { existsSync } from "fs";
import { parseArgs } from "./args";
import { createSideChannelServer } from "./sideChannelServer";
import { spawnClaude, injectText, restoreTerminal, type PtyCleanup } from "./ptySpawner";
import { createHookTransform } from "./hookTransform";
import { registerInstance, unregisterInstance, cleanStaleInstances } from "./instanceRegistry";
import type { GolemAgentInit } from "@golem-code/types";

// Face colors for agent identity (must match frontend/src/faceGen.ts FACE_COLORS)
const FACE_COLORS = [
  "#cc1111", "#1155cc", "#11aa44", "#cc8811", "#8822cc", "#cc1177",
  "#11aaaa", "#cc5511", "#4466cc", "#44aa11", "#aa1166", "#888888",
];

// When running from source, resolve the frontend dist from the repo structure.
// When compiled, frontend assets are embedded via embeddedAssets.generated.ts.
const IS_COMPILED = import.meta.dirname.startsWith("/$bunfs");
const FRONTEND_DIST = IS_COMPILED
  ? null
  : resolve(import.meta.dirname, "../../frontend/dist");

// Lazy-load embedded assets only when compiled (the generated file won't exist in dev)
async function getEmbeddedAssets() {
  if (!IS_COMPILED) return null;
  try {
    const mod = await import("./embeddedAssets.generated");
    return mod.EMBEDDED_ASSETS;
  } catch {
    return null;
  }
}

async function buildFrontend(): Promise<void> {
  const frontendDir = resolve(import.meta.dirname, "../../frontend");

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

  // Resolve frontend assets
  const embeddedAssets = await getEmbeddedAssets();

  if (!IS_COMPILED && !args.dev) {
    // Dev from source — build frontend if needed
    if (FRONTEND_DIST && !existsSync(join(FRONTEND_DIST, "index.html"))) {
      await buildFrontend();
    }
    if (FRONTEND_DIST && !existsSync(join(FRONTEND_DIST, "index.html"))) {
      console.error(`[summon] Frontend not found at ${FRONTEND_DIST}. Run from the golem-code repo or use --dev mode.`);
      process.exit(1);
    }
  }

  if (IS_COMPILED && !embeddedAssets) {
    console.error("[summon] Fatal: compiled binary is missing embedded frontend assets.");
    console.error("Rebuild with: bun run packages/cli/src/embedAssets.ts && bun build packages/cli/src/index.ts --compile --outfile summon");
    process.exit(1);
  }

  // Clean up any stale instance files from crashed sessions
  await cleanStaleInstances();

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

  // Generate unique agent identity for this instance
  const agentInit: GolemAgentInit = {
    type: "agent:init",
    agentId: crypto.randomUUID(),
    seed: Math.floor(Math.random() * 2 ** 32),
    color: FACE_COLORS[Math.floor(Math.random() * FACE_COLORS.length)],
  };

  // Track PTY process for cleanup
  let pty: PtyCleanup | null = null;
  let instanceId: string | null = null;

  // Bridge: hook events → GolemEvents → WebSocket broadcast
  // Both callbacks capture their counterpart lazily (called after init).
  let broadcastEvent: (event: import("@golem-code/types").GolemEvent) => void;
  let handleHookEvent: (data: Record<string, unknown>) => void;

  const hookTransform = createHookTransform({
    onEvent: (event) => broadcastEvent(event),
  });
  handleHookEvent = (data) => hookTransform.handleHookEvent(data);

  // Start side-channel server
  const server = createSideChannelServer({
    port: args.port ?? 6661,
    agentInit,
    // Compiled: serve from embedded assets. Dev from source: serve from disk. --dev: nothing (use Vite).
    ...(embeddedAssets
      ? { embeddedAssets }
      : args.dev
        ? {}
        : { staticDir: FRONTEND_DIST! }),
    onInject: (text) => {
      if (pty) {
        injectText(pty.proc, text);
      }
    },
    onHookEvent: (data) => handleHookEvent(data),
  });

  broadcastEvent = (event) => server.broadcast(event);

  // Register this instance so the plugin can discover our port
  instanceId = registerInstance(server.port);

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
    if (instanceId) unregisterInstance(instanceId);
    pty?.cleanup();
    server.stop();
    process.exit(code);
  }

  process.on("exit", () => {
    if (instanceId) unregisterInstance(instanceId);
    restoreTerminal();
  });

  // Spawn Claude Code in PTY — after this point, stdout belongs to the PTY.
  // No more console.log/warn/error or it will corrupt the TUI.
  pty = spawnClaude(claudeArgs, cwd);

  // Wait for PTY to exit
  const exitCode = await pty.proc.exited;
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
  --port <port>                 Golem server port (default: 6661)
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
