#!/usr/bin/env bun

import { resolve, join, dirname } from "path";
import { existsSync } from "fs";
import { parseArgs } from "./args";
import { createSideChannelServer } from "./sideChannelServer";
import { spawnClaude, injectText, restoreTerminal, type PtyCleanup } from "./ptySpawner";
import { createHookTransform } from "./hookTransform";
import { registerInstance, unregisterInstance, cleanStaleInstances, findPrimary } from "./instanceRegistry";
import type { GolemAgentInit, GolemEvent } from "@golem-code/types";

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

function launchOverlay(url: string): import("bun").Subprocess | null {
  // In compiled mode, resolve as sibling of the real executable on disk.
  // import.meta.dirname points to /$bunfs/root/ in compiled binaries, so use process.execPath.
  const overlayBin = IS_COMPILED
    ? resolve(dirname(process.execPath), "golem-overlay")
    : resolve(import.meta.dirname, "../../overlay/target/release/golem-overlay");

  if (!IS_COMPILED && !existsSync(overlayBin)) {
    console.error(`[summon] Overlay binary not found at ${overlayBin}`);
    console.error("[summon] Build it with: cd packages/overlay && cargo build --release");
    process.exit(1);
  }

  try {
    const proc = Bun.spawn([overlayBin, `${url}?mode=overlay`], {
      stdout: "ignore",
      stderr: "ignore",
    });
    return proc;
  } catch (err) {
    console.error("[summon] Failed to launch overlay:", err);
    return null;
  }
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

/**
 * Connect to an existing primary server as a peer.
 * Forwards all local GolemEvents over a WebSocket and sends
 * agent:disconnect on cleanup.
 */
function connectAsPeer(
  primaryPort: number,
  agentInit: GolemAgentInit,
): { send: (event: GolemEvent) => void; close: () => void } {
  const wsUrl = `ws://localhost:${primaryPort}/peer`;
  let ws: WebSocket | null = null;
  let queue: string[] = [];
  let closed = false;

  function connect() {
    if (closed) return;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      // Send our identity first
      ws!.send(JSON.stringify(agentInit));
      // Flush queued events
      for (const msg of queue) {
        ws!.send(msg);
      }
      queue = [];
    };

    ws.onclose = () => {
      ws = null;
      if (!closed) {
        // Reconnect after a short delay
        setTimeout(connect, 1000);
      }
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  }

  connect();

  return {
    send(event: GolemEvent) {
      const json = JSON.stringify(event);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(json);
      } else {
        queue.push(json);
      }
    },
    close() {
      closed = true;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "agent:disconnect", agentId: agentInit.agentId }));
      }
      ws?.close();
    },
  };
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
    color: FACE_COLORS[Math.floor(Math.random() * FACE_COLORS.length)]!,
  };

  // Check if an existing primary (with overlay) is running
  const existingPrimaryPort = !args.browser ? await findPrimary() : null;

  if (existingPrimaryPort) {
    // ── Peer mode: connect to existing primary ──
    await runAsPeer(args, claudeArgs, cwd, agentInit, existingPrimaryPort);
  } else {
    // ── Primary mode: start server, optionally launch overlay ──
    await runAsPrimary(args, claudeArgs, cwd, agentInit);
  }
}

async function runAsPeer(
  args: ReturnType<typeof parseArgs>,
  claudeArgs: string[],
  cwd: string,
  agentInit: GolemAgentInit,
  primaryPort: number,
) {
  let pty: PtyCleanup | null = null;
  let instanceId: string | null = null;

  // Connect to the primary's peer WebSocket
  const peer = connectAsPeer(primaryPort, agentInit);

  // Hook transform tags events with our agentId and forwards to peer
  const hookTransform = createHookTransform({
    agentId: agentInit.agentId,
    onEvent: (event) => peer.send(event),
  });

  // We still need a minimal HTTP server for the plugin to POST hooks to
  const { createSideChannelServer: createServer } = await import("./sideChannelServer");
  const server = createServer({
    port: args.port ?? 6661,
    agentInit,
    onHookEvent: (data) => hookTransform.handleHookEvent(data),
  });

  instanceId = registerInstance(server.port, false);

  console.log(`[summon] Peer mode: connected to primary on port ${primaryPort}`);
  console.log(`[summon] Hook server: http://localhost:${server.port}`);

  function cleanup(code: number) {
    if (instanceId) unregisterInstance(instanceId);
    peer.close();
    pty?.cleanup();
    server.stop();
    process.exit(code);
  }

  process.on("exit", () => {
    if (instanceId) unregisterInstance(instanceId);
    peer.close();
    restoreTerminal();
  });

  // Spawn Claude Code in PTY
  pty = spawnClaude(claudeArgs, cwd);

  const exitCode = await pty.proc.exited;
  cleanup(exitCode);
}

async function runAsPrimary(
  args: ReturnType<typeof parseArgs>,
  claudeArgs: string[],
  cwd: string,
  agentInit: GolemAgentInit,
) {
  // Resolve frontend assets
  const embeddedAssets = await getEmbeddedAssets();

  if (!IS_COMPILED && !args.dev) {
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

  let pty: PtyCleanup | null = null;
  let overlayProc: import("bun").Subprocess | null = null;
  let instanceId: string | null = null;

  // Bridge: hook events → GolemEvents → WebSocket broadcast
  let broadcastEvent: (event: GolemEvent) => void;

  const hookTransform = createHookTransform({
    agentId: agentInit.agentId,
    onEvent: (event) => broadcastEvent(event),
  });

  // Start side-channel server
  const server = createSideChannelServer({
    port: args.port ?? 6661,
    agentInit,
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
    onHookEvent: (data) => hookTransform.handleHookEvent(data),
  });

  broadcastEvent = (event) => server.broadcast(event);

  // Register as primary so peers can find us
  const isPrimary = !args.browser;
  instanceId = registerInstance(server.port, isPrimary);

  const url = `http://localhost:${server.port}`;
  console.log(`[summon] Golem server: ${url}`);

  if (args.dev) {
    console.log(`[summon] Dev mode: start the frontend separately with "cd packages/frontend && bun run dev"`);
  }

  if (args.browser) {
    if (!args.noOpen && !args.dev) {
      openBrowser(url);
    }
  } else {
    overlayProc = launchOverlay(url);
  }

  function cleanup(code: number) {
    if (instanceId) unregisterInstance(instanceId);
    overlayProc?.kill();
    pty?.cleanup();
    server.stop();
    process.exit(code);
  }

  process.on("exit", () => {
    if (instanceId) unregisterInstance(instanceId);
    overlayProc?.kill();
    restoreTerminal();
  });

  // Spawn Claude Code in PTY — after this point, stdout belongs to the PTY.
  pty = spawnClaude(claudeArgs, cwd);

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
  --browser                     Open in browser instead of desktop overlay
  --no-open                     Don't auto-open the browser (with --browser)
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
