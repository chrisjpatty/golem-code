/**
 * Manages extracting and versioning the embedded overlay binary.
 *
 * On first run (or version change), extracts the overlay from the
 * compiled binary to ~/.golem/bin/golem-overlay and records the version.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const GOLEM_DIR = join(homedir(), ".golem");
const BIN_DIR = join(GOLEM_DIR, "bin");
const OVERLAY_PATH = join(BIN_DIR, "golem-overlay");
const VERSION_FILE = join(BIN_DIR, ".overlay-version");

/**
 * Ensures the embedded overlay binary is extracted to ~/.golem/bin/.
 * Only re-extracts when the version changes (or on first install).
 */
export async function ensureOverlay(currentVersion: string): Promise<string> {
  // Check if already extracted at current version
  if (existsSync(OVERLAY_PATH) && existsSync(VERSION_FILE)) {
    const installedVersion = readFileSync(VERSION_FILE, "utf-8").trim();
    if (installedVersion === currentVersion) {
      return OVERLAY_PATH;
    }
  }

  // Load embedded overlay — uses Bun's file embedding (raw bytes, no base64)
  let embeddedPath: string;
  try {
    const mod = await import("./embeddedOverlay.generated");
    embeddedPath = mod.EMBEDDED_OVERLAY_PATH;
  } catch {
    throw new Error(
      "Embedded overlay binary not found. The build may be incomplete.\n" +
      "Rebuild with: bun run build"
    );
  }

  // Extract to disk
  mkdirSync(BIN_DIR, { recursive: true });
  const data = await Bun.file(embeddedPath).arrayBuffer();
  writeFileSync(OVERLAY_PATH, Buffer.from(data));
  chmodSync(OVERLAY_PATH, 0o755);
  writeFileSync(VERSION_FILE, currentVersion);

  console.error(`[summon] Extracted overlay to ${OVERLAY_PATH}`);
  return OVERLAY_PATH;
}
