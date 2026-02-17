export type DiffLine =
  | { type: "add"; text: string }
  | { type: "remove"; text: string }
  | { type: "context"; text: string }
  | { type: "separator"; text: string };

/**
 * Compute a unified diff between two strings using LCS on lines.
 * Long unchanged sections are collapsed into separators.
 */
export function computeLineDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  // Build LCS table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const raw: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      raw.push({ type: "context", text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ type: "add", text: newLines[j - 1] });
      j--;
    } else {
      raw.push({ type: "remove", text: oldLines[i - 1] });
      i--;
    }
  }
  raw.reverse();

  // Collapse long runs of context lines (keep 2 lines of context around changes)
  const CONTEXT_LINES = 2;
  return collapseContext(raw, CONTEXT_LINES);
}

function collapseContext(lines: DiffLine[], keep: number): DiffLine[] {
  // Find indices of all non-context lines
  const changeIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== "context") changeIndices.push(i);
  }

  if (changeIndices.length === 0) {
    // No changes — just show a short summary
    if (lines.length <= keep * 2 + 1) return lines;
    return [
      ...lines.slice(0, keep),
      { type: "separator", text: `... ${lines.length - keep * 2} lines unchanged ...` },
      ...lines.slice(lines.length - keep),
    ];
  }

  // Mark which lines to keep (within `keep` distance of a change)
  const keepSet = new Set<number>();
  for (const ci of changeIndices) {
    for (let d = -keep; d <= keep; d++) {
      const idx = ci + d;
      if (idx >= 0 && idx < lines.length) keepSet.add(idx);
    }
  }

  const result: DiffLine[] = [];
  let lastKept = -1;
  for (let i = 0; i < lines.length; i++) {
    if (keepSet.has(i)) {
      if (lastKept !== -1 && i - lastKept > 1) {
        const skipped = i - lastKept - 1;
        result.push({ type: "separator", text: `... ${skipped} lines unchanged ...` });
      }
      result.push(lines[i]);
      lastKept = i;
    }
  }

  // Handle leading/trailing collapsed context
  if (changeIndices.length > 0) {
    const firstKept = Math.min(...keepSet);
    if (firstKept > 0) {
      result.unshift({ type: "separator", text: `... ${firstKept} lines unchanged ...` });
    }
    const lastKeptIdx = Math.max(...keepSet);
    if (lastKeptIdx < lines.length - 1) {
      const skipped = lines.length - 1 - lastKeptIdx;
      result.push({ type: "separator", text: `... ${skipped} lines unchanged ...` });
    }
  }

  return result;
}
