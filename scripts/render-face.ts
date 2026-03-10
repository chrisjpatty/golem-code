#!/usr/bin/env bun
/**
 * Render a Golem face to a transparent PNG.
 *
 * Usage:
 *   bun scripts/render-face.ts [--seed <number>] [--color <hex>] [--out <path>]
 *
 * If no seed is given, a random one is generated.
 * Output defaults to ./face-<seed>.png
 */

import puppeteer from "puppeteer";
import { spawn, type Subprocess } from "bun";
import path from "path";

// --- Parse CLI args ---
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const seed = Number(getArg("seed") ?? Math.floor(Math.random() * 1_000_000));
const color = (getArg("color") ?? "#cc1111").replace(/^(?!#)/, "#");
const outPath = getArg("out") ?? `face-${seed}.png`;

// Overlay window dimensions (must match packages/overlay/src/main.rs)
const WIN_WIDTH = 900;
const WIN_HEIGHT = 300;

const frontendDir = path.resolve(import.meta.dir, "../packages/frontend");

// --- Start Vite dev server ---
console.log(`Rendering face: seed=${seed} color=${color}`);

let viteProc: Subprocess | null = null;

async function startVite(): Promise<string> {
  return new Promise((resolve, reject) => {
    viteProc = spawn({
      cmd: ["bunx", "vite", "--port", "0"],
      cwd: frontendDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const timeout = setTimeout(() => reject(new Error("Vite startup timed out")), 15_000);

    const reader = viteProc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value);

        // Vite prints: Local: http://localhost:XXXX/
        const match = buffer.match(/Local:\s+(https?:\/\/localhost:\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
          return;
        }
      }
    })();
  });
}

async function main() {
  const baseUrl = await startVite();
  const url = `${baseUrl}?mode=snapshot&seed=${seed}&color=${encodeURIComponent(color)}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--enable-webgl",
      "--enable-gpu",
      "--use-gl=angle",
      "--use-angle=metal",
      "--no-sandbox",
      "--enable-features=Vulkan,UseSkiaRenderer",
    ],
  });

  try {
    const page = await browser.newPage();

    // Forward browser console to Node for debugging
    page.on("console", (msg) => console.log(`[browser] ${msg.text()}`));
    page.on("pageerror", (err) => console.error(`[browser error]`, err));

    await page.setViewport({ width: WIN_WIDTH, height: WIN_HEIGHT, deviceScaleFactor: 2 });

    await page.goto(url, { waitUntil: "domcontentloaded" });

    // Wait for the scene to signal readiness
    await page.waitForFunction("window.__SNAPSHOT_READY__ === true", { timeout: 10_000 });

    // Extra frames for bloom/post-processing to settle
    await new Promise((r) => setTimeout(r, 500));

    await page.screenshot({
      path: outPath,
      type: "png",
      omitBackground: true,
    });

    // Trim transparent pixels around the face
    const trim = spawn({
      cmd: ["magick", outPath, "-trim", "+repage", outPath],
      stdout: "inherit",
      stderr: "inherit",
    });
    await trim.exited;

    console.log(`Saved: ${outPath}`);
  } finally {
    await browser.close();
    viteProc?.kill();
  }
}

main().catch((err) => {
  console.error(err);
  viteProc?.kill();
  process.exit(1);
});
