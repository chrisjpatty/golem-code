#!/usr/bin/env bun

import { resolve, join } from "path";
import { existsSync } from "fs";
import { createGolemServer, type GolemServerOptions, type GolemQueryOptions } from "@golem-code/agent";
import { parseArgs } from "./args";

const FRONTEND_DIST = resolve(import.meta.dirname, "../../frontend/dist");

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
    // Linux and others
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
    console.log("summon (golem-code) 0.0.1");
    process.exit(0);
  }

  // Build frontend if dist doesn't exist
  if (!args.dev && !existsSync(join(FRONTEND_DIST, "index.html"))) {
    await buildFrontend();
  }

  // Resolve working directory
  const cwd = args.cwd ? resolve(args.cwd) : process.cwd();

  // Build query options from CLI args
  const queryOptions: GolemQueryOptions = {
    cwd,
    ...(args.model ? { model: args.model } : {}),
    ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
    ...(args.maxTurns ? { maxTurns: args.maxTurns } : {}),
    ...(args.maxBudgetUsd ? { maxBudgetUsd: args.maxBudgetUsd } : {}),
    ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
    ...(args.allowedTools ? { allowedTools: args.allowedTools } : {}),
    ...(args.disallowedTools ? { disallowedTools: args.disallowedTools } : {}),
    ...(args.continue ? { continue: true } : {}),
    ...(args.resume ? { resume: args.resume } : {}),
    ...(args.debug ? { debug: true } : {}),
    ...(args.additionalDirectories ? { additionalDirectories: args.additionalDirectories } : {}),
  };

  const serverOptions: GolemServerOptions = {
    port: args.port,
    queryOptions,
    // In dev mode, don't serve static files (use Vite dev server separately)
    ...(args.dev ? {} : { staticDir: FRONTEND_DIST }),
    // If a prompt was provided, auto-run it when the frontend connects
    ...(args.prompt ? { initialPrompt: args.prompt } : {}),
  };

  const server = createGolemServer(serverOptions);
  const url = `http://localhost:${server.port}`;

  console.log(`[summon] Working directory: ${cwd}`);
  console.log(`[summon] Golem server: ${url}`);

  if (args.dev) {
    console.log(`[summon] Dev mode: start the frontend separately with "cd packages/frontend && bun run dev"`);
  }

  if (!args.noOpen && !args.dev) {
    openBrowser(url);
  }

  // Keep the process alive
  process.on("SIGINT", () => {
    console.log("\n[summon] Shutting down...");
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    server.stop();
    process.exit(0);
  });
}

function printHelp() {
  console.log(`
summon - Launch golem-code, a visual Claude Code alternative

Usage:
  summon [options] [prompt]

Options:
  -p, --prompt <text>           Initial prompt to send
  -m, --model <model>           Claude model to use
  --permission-mode <mode>      Permission mode: default, acceptEdits, plan, dontAsk
  --max-turns <n>               Maximum conversation turns
  --max-budget-usd <n>          Maximum budget in USD
  --system-prompt <text>        Custom system prompt
  --allowed-tools <tools>       Comma-separated list of tools to auto-allow
  --disallowed-tools <tools>    Comma-separated list of tools to disallow
  -c, --continue                Continue the most recent conversation
  -r, --resume <session-id>     Resume a specific session
  --cwd <dir>                   Working directory (default: current directory)
  --add-dir <dir>               Additional directory to allow (can repeat)
  --port <port>                 Server port (default: 4747)
  --debug                       Enable debug logging
  --no-open                     Don't auto-open the browser
  --dev                         Dev mode: skip frontend build and static serving
  -v, --version                 Show version
  -h, --help                    Show this help

Examples:
  summon                        Launch in current directory
  summon "Fix the failing tests"   Launch with an initial prompt
  summon --model claude-sonnet-4-5-20250929 -c   Continue with Sonnet
  summon --cwd ~/my-project     Launch in a specific directory
`.trim());
}

main().catch((err) => {
  console.error("[summon] Fatal error:", err);
  process.exit(1);
});
