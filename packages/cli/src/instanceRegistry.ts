/**
 * Manages instance registration in ~/.golem/instances/.
 * Each running Golem server writes its port to a file so the
 * Claude Code plugin can discover and forward hook events.
 *
 * Instance files contain JSON: { port, primary }
 * Primary instances run the overlay and accept peer connections.
 */

import { mkdirSync, writeFileSync, unlinkSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const INSTANCES_DIR = join(homedir(), ".golem", "instances");

type InstanceData = {
  port: number;
  primary: boolean;
};

function ensureDir() {
  mkdirSync(INSTANCES_DIR, { recursive: true });
}

/** Register this instance. Returns the instance ID for cleanup. */
export function registerInstance(port: number, primary: boolean): string {
  ensureDir();
  const id = crypto.randomUUID();
  const data: InstanceData = { port, primary };
  writeFileSync(join(INSTANCES_DIR, id), JSON.stringify(data), "utf-8");
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

/** Find the port of a healthy primary instance, or null if none exists. */
export async function findPrimary(): Promise<number | null> {
  let files: string[];
  try {
    files = readdirSync(INSTANCES_DIR);
  } catch {
    return null;
  }

  for (const file of files) {
    const filePath = join(INSTANCES_DIR, file);
    let data: InstanceData;
    try {
      const raw = readFileSync(filePath, "utf-8").trim();
      // Handle legacy format (plain port number)
      const parsed = raw.startsWith("{") ? JSON.parse(raw) : { port: parseInt(raw, 10), primary: false };
      data = parsed;
      if (isNaN(data.port)) throw new Error("invalid");
    } catch {
      try { unlinkSync(filePath); } catch {}
      continue;
    }

    if (!data.primary) continue;

    // Check if the primary is still alive
    try {
      const res = await fetch(`http://localhost:${data.port}/health`, {
        signal: AbortSignal.timeout(500),
      });
      if (res.ok) return data.port;
    } catch {
      // Dead primary — clean up
      try { unlinkSync(filePath); } catch {}
    }
  }

  return null;
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
      const raw = readFileSync(filePath, "utf-8").trim();
      const parsed = raw.startsWith("{") ? JSON.parse(raw) : { port: parseInt(raw, 10) };
      port = parsed.port;
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
