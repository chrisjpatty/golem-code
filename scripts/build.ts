#!/usr/bin/env bun

/**
 * Unified build script for golem-code.
 *
 * Builds all packages and produces a distributable directory at dist/
 * containing:
 *   - summon          (CLI binary, with embedded frontend assets)
 *   - golem-overlay   (Tauri overlay binary)
 *
 * The CLI resolves golem-overlay as a sibling binary, so both must
 * live in the same directory.
 *
 * Usage:
 *   bun run scripts/build.ts              # build everything
 *   bun run scripts/build.ts --skip-overlay  # skip the Rust/Tauri build
 */

import { resolve, join } from "path";
import { existsSync, mkdirSync, copyFileSync, chmodSync } from "fs";

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

// ── 2. Embed frontend assets into CLI ────────────────────────────
run(
  ["bun", "run", join(CLI_DIR, "src/embedAssets.ts")],
  ROOT,
  "Embedding frontend assets into CLI",
);

// ── 3. Compile CLI binary ────────────────────────────────────────
mkdirSync(DIST, { recursive: true });
const summonOut = join(DIST, "summon");
run(
  ["bun", "build", join(CLI_DIR, "src/index.ts"), "--compile", "--outfile", summonOut],
  ROOT,
  "Compiling CLI binary",
);

// ── 4. Overlay (Tauri/Rust) ──────────────────────────────────────
if (!skipOverlay) {
  run(["cargo", "build", "--release"], OVERLAY_DIR, "Building overlay (Tauri)");

  const overlayBin = join(OVERLAY_DIR, "target/release/golem-overlay");
  if (!existsSync(overlayBin)) {
    console.error(`[build] FAILED: overlay binary not found at ${overlayBin}`);
    process.exit(1);
  }

  const overlayDest = join(DIST, "golem-overlay");
  copyFileSync(overlayBin, overlayDest);
  chmodSync(overlayDest, 0o755);
  console.log(`[build] Copied golem-overlay to dist/`);
} else {
  console.log("\n[build] Skipping overlay build (--skip-overlay)");
}

// ── Done ─────────────────────────────────────────────────────────
console.log(`\n[build] Done! Distributable binaries in: ${DIST}/`);
console.log(`  - ${join(DIST, "summon")}`);
if (!skipOverlay) {
  console.log(`  - ${join(DIST, "golem-overlay")}`);
}
