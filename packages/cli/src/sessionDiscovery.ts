/**
 * Discovers the active JSONL session file for a Claude Code session.
 *
 * Session files live at: ~/.claude/projects/<sanitized-cwd>/<session-id>.jsonl
 */

import { watch, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type SessionDiscoveryOptions = {
  /** Working directory of the Claude Code session */
  cwd: string;
  /** Whether we're continuing/resuming (watch for modifications to existing files) */
  continueOrResume?: boolean;
  /** Timeout in ms before falling back to most recently modified file (default: 10000) */
  timeoutMs?: number;
};

/** Sanitize a path the way Claude Code does for project directories */
export function sanitizePath(p: string): string {
  return p.replaceAll("/", "-");
}

export function getProjectDir(cwd: string): string {
  const sanitized = sanitizePath(cwd);
  return join(homedir(), ".claude", "projects", sanitized);
}

export async function discoverSessionFile(
  options: SessionDiscoveryOptions,
): Promise<string> {
  const { cwd, continueOrResume = false, timeoutMs = 10000 } = options;
  const projectDir = getProjectDir(cwd);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    let watcher: ReturnType<typeof watch> | null = null;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    function cleanup() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    }

    function found(filePath: string) {
      cleanup();
      resolve(filePath);
    }

    // Try watching the directory for new/modified .jsonl files
    try {
      watcher = watch(projectDir, (eventType, filename) => {
        if (!filename || !filename.endsWith(".jsonl")) return;

        const fullPath = join(projectDir, filename);

        if (continueOrResume) {
          // For continue/resume, any modification counts
          found(fullPath);
          return;
        }

        // For new sessions, check if the file was created after we started
        try {
          const stat = statSync(fullPath);
          if (stat.birthtimeMs >= startTime - 1000) {
            found(fullPath);
          }
        } catch {
          // File may have been deleted between event and stat
        }
      });
    } catch {
      // Directory might not exist yet; that's fine, we'll use the fallback
    }

    // Timeout fallback: pick the most recently modified .jsonl file
    timeoutHandle = setTimeout(() => {
      cleanup();

      try {
        const files = readdirSync(projectDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => {
            const fullPath = join(projectDir, f);
            const stat = statSync(fullPath);
            return { path: fullPath, mtime: stat.mtimeMs };
          })
          .sort((a, b) => b.mtime - a.mtime);

        if (files.length > 0) {
          resolve(files[0]!.path);
        } else {
          reject(new Error(`No JSONL session files found in ${projectDir}`));
        }
      } catch (err) {
        reject(
          new Error(
            `Failed to find session files in ${projectDir}: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    }, timeoutMs);
  });
}
