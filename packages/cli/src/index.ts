#!/usr/bin/env bun

import { resolve, join, dirname } from "path";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync, rmdirSync } from "fs";
import { homedir } from "os";
import { parseArgs } from "./args";
import { createSideChannelServer, type SideChannelServer, type EmbeddedAsset } from "./sideChannelServer";
import { spawnClaude, injectText, restoreTerminal, type PtyCleanup } from "./ptySpawner";
import { createHookTransform } from "./hookTransform";
import { registerInstance, unregisterInstance, cleanStaleInstances, findPrimary, hasOtherInstances } from "./instanceRegistry";
import { FACE_COLORS, type GolemAgentInit, type GolemEvent } from "@golem-code/types";
import { focusMyTerminal } from "./terminalFocus";
import { ensureOverlay } from "./overlayManager";
import { selfUpdate, checkForUpdate } from "./selfUpdate";

const DEFAULT_PORT = 6661;

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

const GOLEM_DIR = join(homedir(), ".golem");
const OVERLAY_PID_FILE = join(GOLEM_DIR, "overlay.pid");
const PRIMARY_LOCK_DIR = join(GOLEM_DIR, "primary.lock");

/**
 * Try to acquire the primary lock (atomic mkdir).
 * Returns true if this process acquired it, false if another process holds it.
 */
function tryAcquirePrimaryLock(): boolean {
  try {
    mkdirSync(PRIMARY_LOCK_DIR);
    return true;
  } catch {
    return false;
  }
}

function releasePrimaryLock(): void {
  try {
    rmdirSync(PRIMARY_LOCK_DIR);
  } catch {
    // Lock already released
  }
}

/** Kill any existing overlay process tracked by the PID file. */
function killExistingOverlay(): void {
  try {
    const pid = parseInt(readFileSync(OVERLAY_PID_FILE, "utf-8").trim(), 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process already gone — fine
      }
    }
    unlinkSync(OVERLAY_PID_FILE);
  } catch {
    // No PID file or already cleaned up
  }
}

function launchOverlay(overlayBin: string, url: string, debug?: boolean): import("bun").Subprocess | null {
  // Ensure only one overlay exists at any time
  killExistingOverlay();

  try {
    const qs = debug ? "?mode=overlay&golem-debug=1" : "?mode=overlay";
    const proc = Bun.spawn([overlayBin, `${url}${qs}`], {
      stdout: "ignore",
      stderr: "ignore",
    });

    // Record PID so other instances (or promotion) can find and kill it
    try {
      mkdirSync(join(homedir(), ".golem"), { recursive: true });
      writeFileSync(OVERLAY_PID_FILE, String(proc.pid));
    } catch {
      // Non-fatal — worst case we can't track it
    }

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

/** Frontend config passed to server for serving the UI */
type FrontendConfig = {
  embeddedAssets?: Record<string, EmbeddedAsset>;
  staticDir?: string;
};

/**
 * Connect to an existing primary server as a peer.
 * Forwards all local GolemEvents over a WebSocket and sends
 * agent:disconnect on cleanup.
 *
 * If onPrimaryLost is provided, it's called once when the primary
 * becomes unreachable (health check fails after WebSocket drops).
 */
function connectAsPeer(
  primaryPort: number,
  agentInit: GolemAgentInit,
  onPrimaryLost?: () => void,
): { send: (event: GolemEvent) => void; close: () => void } {
  const wsUrl = `ws://localhost:${primaryPort}/peer`;
  let ws: WebSocket | null = null;
  let queue: string[] = [];
  let closed = false;
  let primaryLostFired = false;

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

    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "focus:request") {
          focusMyTerminal();
        }
      } catch {
        // Ignore invalid JSON
      }
    };

    ws.onclose = () => {
      ws = null;
      if (closed) return;

      if (onPrimaryLost && !primaryLostFired) {
        // Check if primary is truly gone before triggering promotion
        fetch(`http://localhost:${primaryPort}/health`, {
          signal: AbortSignal.timeout(500),
        })
          .then((res) => {
            if (!res.ok) throw new Error("unhealthy");
            // Primary still alive, just reconnect
            setTimeout(connect, 1000);
          })
          .catch(() => {
            if (!closed && !primaryLostFired) {
              primaryLostFired = true;
              onPrimaryLost();
            }
          });
      } else {
        // No promotion handler or already fired — keep reconnecting
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

  const pkg = await import("../package.json");

  // Print banner
  const RED = "\x1b[31m";
  const RESET = "\x1b[0m";
  const DIM = "\x1b[2m";
  console.log(RED +
`  ▄▀  ████▄ █     ▄███▄   █▀▄▀█
▄▀    █   █ █     █▀   ▀  █ █ █
█ ▀▄  █   █ █     ██▄▄    █ ▄ █
█   █ ▀████ ███▄  █▄   ▄▀ █   █
 ███            ▀ ▀███▀      █
                            ▀  ` + RESET);
  console.log(`${DIM}                    v${pkg.version}${RESET}`);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.version) {
    console.log(`summon (golem-code) ${pkg.version}`);
    process.exit(0);
  }

  if (args.update) {
    await selfUpdate(pkg.version);
    process.exit(0);
  }

  // Check for updates with a 1s timeout — must complete before PTY takes over stdout
  const updateAbort = new AbortController();
  await Promise.race([
    checkForUpdate(pkg.version, updateAbort.signal),
    new Promise<void>((r) => setTimeout(() => { updateAbort.abort(); r(); }, 1000)),
  ]);

  // Clean up any stale instance files from crashed sessions
  await cleanStaleInstances();

  // Clean up stale primary lock if no healthy primary exists
  if (existsSync(PRIMARY_LOCK_DIR)) {
    const healthyPrimary = await findPrimary();
    if (!healthyPrimary) {
      releasePrimaryLock();
    }
  }

  // Clean up stale overlay PID if the process is no longer running
  try {
    const pid = parseInt(readFileSync(OVERLAY_PID_FILE, "utf-8").trim(), 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0); // signal 0 = just check if alive
      } catch {
        unlinkSync(OVERLAY_PID_FILE); // process is dead, clean up
      }
    }
  } catch {
    // No PID file — nothing to clean
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

  // Generate unique agent identity for this instance
  const agentInit: GolemAgentInit = {
    type: "agent:init",
    agentId: crypto.randomUUID(),
    seed: Math.floor(Math.random() * 2 ** 32),
    color: FACE_COLORS[Math.floor(Math.random() * FACE_COLORS.length)]!,
  };

  console.log(`\x1b[2m                    seed: ${agentInit.seed}\x1b[0m`);
  console.log("");

  // Resolve frontend assets early — needed by both primary and peer (for promotion)
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

  const frontendConfig: FrontendConfig = embeddedAssets
    ? { embeddedAssets }
    : args.dev
      ? {}
      : { staticDir: FRONTEND_DIST! };

  // Resolve overlay binary (needed by primary, and peer if it promotes)
  let overlayBin: string | undefined;
  if (!args.browser) {
    if (IS_COMPILED) {
      const pkg = await import("../package.json");
      overlayBin = await ensureOverlay(pkg.version);
    } else {
      const bin = resolve(import.meta.dirname, "../../overlay/target/release/golem-overlay");
      if (existsSync(bin)) {
        overlayBin = bin;
      } else {
        console.error(`[summon] Overlay binary not found at ${bin}`);
        console.error("[summon] Build it with: cd packages/overlay && cargo build --release");
        process.exit(1);
      }
    }
  }

  // Determine primary vs peer mode.
  // Use an atomic lock to prevent two instances from both becoming primary.
  if (!args.browser && tryAcquirePrimaryLock()) {
    // We hold the lock — but check if a primary already exists (e.g. stale lock was cleaned)
    const existingPrimaryPort = await findPrimary();
    if (existingPrimaryPort) {
      // Primary already running — release lock and join as peer
      releasePrimaryLock();
      await runAsPeer(args, claudeArgs, cwd, agentInit, existingPrimaryPort, frontendConfig, overlayBin);
    } else {
      // ── Primary mode: start server, launch overlay ──
      await runAsPrimary(args, claudeArgs, cwd, agentInit, frontendConfig, overlayBin);
    }
  } else {
    // Couldn't acquire lock (or browser mode) — find primary and join as peer
    // Wait briefly for the primary to finish starting up
    let primaryPort: number | null = null;
    for (let i = 0; i < 10; i++) {
      primaryPort = await findPrimary();
      if (primaryPort) break;
      await new Promise((r) => setTimeout(r, 300));
    }

    if (primaryPort) {
      await runAsPeer(args, claudeArgs, cwd, agentInit, primaryPort, frontendConfig, overlayBin);
    } else if (!args.browser) {
      // Lock holder may have crashed — force acquire and become primary
      releasePrimaryLock();
      tryAcquirePrimaryLock();
      await runAsPrimary(args, claudeArgs, cwd, agentInit, frontendConfig, overlayBin);
    }
  }
}

async function runAsPeer(
  args: ReturnType<typeof parseArgs>,
  claudeArgs: string[],
  cwd: string,
  agentInit: GolemAgentInit,
  primaryPort: number,
  frontendConfig: FrontendConfig,
  overlayBin?: string,
) {
  let pty: PtyCleanup | null = null;
  let instanceId: string | null = null;
  let promotedServer: SideChannelServer | null = null;

  // Mutable event sink: initially forwards to peer, switches to local broadcast on promotion
  let eventSink: (event: GolemEvent) => void = () => {};

  const hookTransform = createHookTransform({
    agentId: agentInit.agentId,
    onEvent: (event) => eventSink(event),
  });

  // Minimal HTTP server for receiving hooks from our Claude Code instance
  const hookServer = createSideChannelServer({
    port: args.port ?? DEFAULT_PORT,
    agentInit,
    onHookEvent: (data) => hookTransform.handleHookEvent(data),
  });

  instanceId = registerInstance(hookServer.port, false);

  // Promotion handler: called when the primary becomes unreachable
  function handlePrimaryLost() {
    // Try to acquire the primary lock — only one peer should promote
    if (!tryAcquirePrimaryLock()) {
      console.error("[summon] Primary lost, another peer is promoting — reconnecting...");
      setTimeout(async () => {
        const newPrimary = await findPrimary();
        if (newPrimary && !promotedServer) {
          const newPeer = connectAsPeer(newPrimary, agentInit, handlePrimaryLost);
          eventSink = (event) => newPeer.send(event);
        }
      }, 1500);
      return;
    }

    console.error("[summon] Primary lost, attempting promotion...");

    try {
      // Try to start a server on the old primary's port so the overlay auto-reconnects
      promotedServer = createSideChannelServer({
        port: primaryPort,
        ...frontendConfig,
        agentInit,
        onInject: (text) => {
          if (pty) injectText(pty.proc, text);
        },
        onFocusAgent: () => focusMyTerminal(),
        onHookEvent: (data) => hookTransform.handleHookEvent(data),
      });

      // Wire events through the promoted server (overlay clients are connected here)
      eventSink = (event) => promotedServer!.broadcast(event);

      // Re-register as primary
      if (instanceId) unregisterInstance(instanceId);
      instanceId = registerInstance(promotedServer.port, true);

      if (promotedServer.port === primaryPort) {
        console.error(`[summon] Promoted to primary on port ${primaryPort}`);
      } else {
        // Couldn't get the exact port — launch a new overlay pointing to our port
        console.error(`[summon] Promoted on port ${promotedServer.port} (overlay port ${primaryPort} busy)`);
        if (overlayBin) {
          launchOverlay(overlayBin, `http://localhost:${promotedServer.port}`, args.golemDebug);
        }
      }
    } catch (err) {
      console.error("[summon] Promotion failed, reconnecting as peer...");
      // Another peer may have promoted — try to reconnect
      setTimeout(async () => {
        const newPrimary = await findPrimary();
        if (newPrimary && !promotedServer) {
          const newPeer = connectAsPeer(newPrimary, agentInit, handlePrimaryLost);
          eventSink = (event) => newPeer.send(event);
        }
      }, 1500);
    }
  }

  // Connect to the primary's peer WebSocket with promotion support
  const peer = connectAsPeer(primaryPort, agentInit, handlePrimaryLost);
  eventSink = (event) => peer.send(event);

  console.log(`[summon] Peer mode: connected to primary on port ${primaryPort}`);
  console.log(`[summon] Hook server: http://localhost:${hookServer.port}`);

  let cleanedUp = false;

  function cleanup(code: number) {
    if (cleanedUp) return;
    cleanedUp = true;
    if (instanceId) unregisterInstance(instanceId);
    if (promotedServer) releasePrimaryLock();
    peer.close();
    pty?.cleanup();
    hookServer.stop();
    if (promotedServer) {
      promotedServer.stop();
    }
    process.exit(code);
  }

  process.on("SIGHUP", () => cleanup(1));
  process.on("SIGTERM", () => cleanup(1));
  process.on("SIGINT", () => cleanup(1));
  process.on("exit", () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (instanceId) unregisterInstance(instanceId);
    if (promotedServer) releasePrimaryLock();
    peer.close();
    restoreTerminal();
  });

  // Spawn Claude Code in PTY with GOLEM_PORT so hooks target this instance's hook server
  pty = spawnClaude(claudeArgs, cwd, { GOLEM_PORT: String(hookServer.port) });

  const exitCode = await pty.proc.exited;
  cleanup(exitCode);
}

async function runAsPrimary(
  args: ReturnType<typeof parseArgs>,
  claudeArgs: string[],
  cwd: string,
  agentInit: GolemAgentInit,
  frontendConfig: FrontendConfig,
  overlayBin?: string,
) {
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
    port: args.port ?? DEFAULT_PORT,
    agentInit,
    ...frontendConfig,
    onInject: (text) => {
      if (pty) {
        injectText(pty.proc, text);
      }
    },
    onFocusAgent: (_agentId) => {
      focusMyTerminal();
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
  } else if (overlayBin) {
    overlayProc = launchOverlay(overlayBin, url, args.golemDebug);
  }

  let cleanedUp = false;

  function cleanup(code: number) {
    if (cleanedUp) return;
    cleanedUp = true;
    if (instanceId) unregisterInstance(instanceId);
    releasePrimaryLock();
    // Only kill overlay if no other instances are running to take over
    if (overlayProc && !hasOtherInstances()) {
      overlayProc.kill();
      try { unlinkSync(OVERLAY_PID_FILE); } catch {}
    }
    pty?.cleanup();
    server.stop();
    process.exit(code);
  }

  process.on("SIGHUP", () => cleanup(1));
  process.on("SIGTERM", () => cleanup(1));
  process.on("SIGINT", () => cleanup(1));
  process.on("exit", () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (instanceId) unregisterInstance(instanceId);
    releasePrimaryLock();
    if (overlayProc && !hasOtherInstances()) {
      overlayProc.kill();
      try { unlinkSync(OVERLAY_PID_FILE); } catch {}
    }
    restoreTerminal();
  });

  // Spawn Claude Code in PTY — after this point, stdout belongs to the PTY.
  pty = spawnClaude(claudeArgs, cwd, { GOLEM_PORT: String(server.port) });

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
  --update                      Update summon to the latest version
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
