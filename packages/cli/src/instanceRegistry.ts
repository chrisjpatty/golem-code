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

  // Parse all instance files and filter to primaries
  const candidates: { filePath: string; data: InstanceData }[] = [];
  for (const file of files) {
    const filePath = join(INSTANCES_DIR, file);
    try {
      const raw = readFileSync(filePath, "utf-8").trim();
      const parsed = raw.startsWith("{") ? JSON.parse(raw) : { port: parseInt(raw, 10), primary: false };
      if (isNaN(parsed.port)) throw new Error("invalid");
      if (parsed.primary) candidates.push({ filePath, data: parsed });
    } catch {
      try { unlinkSync(filePath); } catch {}
    }
  }

  // Health-check all primaries in parallel
  const results = await Promise.all(
    candidates.map(async ({ filePath, data }) => {
      try {
        const res = await fetch(`http://localhost:${data.port}/health`, {
          signal: AbortSignal.timeout(500),
        });
        if (res.ok) return data.port;
      } catch {
        try { unlinkSync(filePath); } catch {}
      }
      return null;
    })
  );

  return results.find((port) => port !== null) ?? null;
}

/** Check if any other instances are registered (call after unregistering self). */
export function hasOtherInstances(): boolean {
  try {
    const files = readdirSync(INSTANCES_DIR);
    return files.length > 0;
  } catch {
    return false;
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

  // Parse all instance files, removing corrupt ones
  const instances: { filePath: string; port: number }[] = [];
  for (const file of files) {
    const filePath = join(INSTANCES_DIR, file);
    try {
      const raw = readFileSync(filePath, "utf-8").trim();
      const parsed = raw.startsWith("{") ? JSON.parse(raw) : { port: parseInt(raw, 10) };
      if (isNaN(parsed.port)) throw new Error("invalid");
      instances.push({ filePath, port: parsed.port });
    } catch {
      try { unlinkSync(filePath); } catch {}
    }
  }

  // Health-check all instances in parallel
  await Promise.all(
    instances.map(async ({ filePath, port }) => {
      try {
        const res = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(500),
        });
        if (!res.ok) throw new Error("unhealthy");
      } catch {
        try { unlinkSync(filePath); } catch {}
      }
    })
  );
}
