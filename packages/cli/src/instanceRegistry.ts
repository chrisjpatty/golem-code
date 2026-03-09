/**
 * Manages instance registration in ~/.golem/instances/.
 * Each running Golem server writes its port to a file so the
 * Claude Code plugin can discover and forward hook events.
 */

import { mkdirSync, writeFileSync, unlinkSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const INSTANCES_DIR = join(homedir(), ".golem", "instances");

function ensureDir() {
  mkdirSync(INSTANCES_DIR, { recursive: true });
}

/** Register this instance's port. Returns the instance ID for cleanup. */
export function registerInstance(port: number): string {
  ensureDir();
  const id = crypto.randomUUID();
  writeFileSync(join(INSTANCES_DIR, id), String(port), "utf-8");
  return id;
}

/** Unregister an instance on shutdown. */
export function unregisterInstance(id: string): void {
  try {
    unlinkSync(join(INSTANCES_DIR, id));
  } catch {
    // File may already be gone
  }
}

/** Remove stale instance files (ports that aren't responding). */
export async function cleanStaleInstances(): Promise<void> {
  let files: string[];
  try {
    files = readdirSync(INSTANCES_DIR);
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = join(INSTANCES_DIR, file);
    let port: number;
    try {
      port = parseInt(readFileSync(filePath, "utf-8").trim(), 10);
      if (isNaN(port)) throw new Error("invalid");
    } catch {
      // Corrupt file — remove it
      try { unlinkSync(filePath); } catch {}
      continue;
    }

    try {
      const res = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (!res.ok) throw new Error("unhealthy");
    } catch {
      // Port not responding — stale instance
      try { unlinkSync(filePath); } catch {}
    }
  }
}
