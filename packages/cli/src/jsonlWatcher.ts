/**
 * Tails a JSONL session file and emits parsed events.
 * Handles partial writes by buffering incomplete lines.
 */

import { openSync, readSync, closeSync, statSync, watchFile, unwatchFile } from "fs";

export type JsonlWatcherOptions = {
  /** Called for each complete JSON object parsed from a line */
  onEvent: (data: unknown) => void;
  /** Poll interval in ms (default: 250) */
  pollIntervalMs?: number;
};

export type JsonlWatcher = {
  stop: () => void;
};

export function watchJsonlFile(
  filePath: string,
  options: JsonlWatcherOptions,
): JsonlWatcher {
  const { onEvent, pollIntervalMs = 250 } = options;

  let offset = 0;
  let buffer = "";
  let stopped = false;

  // Initialize offset to current file size so we only get new events
  try {
    const stat = statSync(filePath);
    offset = stat.size;
  } catch {
    // File doesn't exist yet, start from 0
  }

  function readNewData() {
    if (stopped) return;

    let fileSize: number;
    try {
      const stat = statSync(filePath);
      fileSize = stat.size;
    } catch {
      return; // File gone or inaccessible
    }

    if (fileSize <= offset) return;

    // Read only the new bytes using positional read
    const bytesToRead = fileSize - offset;
    const buf = Buffer.alloc(bytesToRead);
    let fd: number | null = null;
    try {
      fd = openSync(filePath, "r");
      readSync(fd, buf, 0, bytesToRead, offset);
      offset = fileSize;

      buffer += buf.toString("utf-8");
      const lines = buffer.split("\n");

      // Last element is either empty (line ended with \n) or an incomplete line
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          onEvent(parsed);
        } catch {
          // Skip unparseable lines
        }
      }
    } catch {
      // Read error, retry next poll
    } finally {
      if (fd !== null) {
        try { closeSync(fd); } catch { /* ignore */ }
      }
    }
  }

  watchFile(filePath, { interval: pollIntervalMs }, readNewData);

  // Also do an initial read in case data was already written
  readNewData();

  return {
    stop() {
      stopped = true;
      unwatchFile(filePath);
    },
  };
}
