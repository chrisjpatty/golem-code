#!/usr/bin/env bun

/**
 * Unified build script for golem-code.
 *
 * Builds all packages and produces a single distributable binary at dist/summon.
 * The overlay binary is embedded inside the CLI and extracted to ~/.golem/bin/
 * on first run (or version change).
 *
 * Usage:
 *   bun run scripts/build.ts              # build everything
 *   bun run scripts/build.ts --skip-overlay  # skip the Rust/Tauri build
 */

import { resolve, join } from "path";
import { existsSync, mkdirSync } from "fs";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const FRONTEND_DIR = join(ROOT, "packages/frontend");
const CLI_DIR = join(ROOT, "packages/cli");
const OVERLAY_DIR = join(ROOT, "packages/overlay");

const skipOverlay = process.argv.includes("--skip-overlay");

function run(cmd: string[], cwd: string, label: string): void {
  console.log(`\n[build] ${label}...`);
  const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    console.error(`[build] FAILED: ${label} (exit code ${result.exitCode})`);
    process.exit(1);
  }
}

// ── 1. Frontend ──────────────────────────────────────────────────
run(["bun", "run", "build"], FRONTEND_DIR, "Building frontend (Vite)");

// ── 2. Overlay (Tauri/Rust) ──────────────────────────────────────
// Built before the CLI so we can embed the binary into it.
if (!skipOverlay) {
  run(["cargo", "build", "--release"], OVERLAY_DIR, "Building overlay (Tauri)");

  const overlayBin = join(OVERLAY_DIR, "target/release/golem-overlay");
  if (!existsSync(overlayBin)) {
    console.error(`[build] FAILED: overlay binary not found at ${overlayBin}`);
    process.exit(1);
  }
} else {
  console.log("\n[build] Skipping overlay build (--skip-overlay)");
}

// ── 3. Embed frontend assets into CLI ────────────────────────────
run(
  ["bun", "run", join(CLI_DIR, "src/embedAssets.ts")],
  ROOT,
  "Embedding frontend assets into CLI",
);

// ── 4. Embed overlay binary into CLI ─────────────────────────────
if (!skipOverlay) {
  run(
    ["bun", "run", join(CLI_DIR, "src/embedOverlay.ts")],
    ROOT,
    "Embedding overlay binary into CLI",
  );
}

// ── 5. Compile CLI binary ────────────────────────────────────────
mkdirSync(DIST, { recursive: true });
const summonOut = join(DIST, "summon");
run(
  ["bun", "build", join(CLI_DIR, "src/index.ts"), "--compile", "--outfile", summonOut],
  ROOT,
  "Compiling CLI binary",
);

// ── Done ─────────────────────────────────────────────────────────
console.log(`\n[build] Done! Distributable binary: ${summonOut}`);
