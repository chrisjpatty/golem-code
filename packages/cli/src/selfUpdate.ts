/**
 * Self-update: downloads the latest summon binary from GitHub Releases
 * and replaces the current executable in-place.
 */

import { existsSync, renameSync, unlinkSync, chmodSync } from "fs";
import { join } from "path";

const REPO = "chrisjpatty/golem-code";
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type Release = {
  tag_name: string;
  assets: ReleaseAsset[];
};

function getAssetName(): string {
  if (process.platform !== "darwin") {
    throw new Error(`Unsupported platform: ${process.platform}. Summon currently only supports macOS.`);
  }
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `summon-darwin-${arch}`;
}

export async function selfUpdate(currentVersion: string): Promise<void> {
  console.log(`[summon] Current version: ${currentVersion}`);
  console.log("[summon] Checking for updates...");

  // Fetch latest release info
  const res = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to check for updates: GitHub API returned ${res.status}`);
  }
  const release = (await res.json()) as Release;

  const latestVersion = release.tag_name.replace(/^v/, "");
  if (latestVersion === currentVersion) {
    console.log(`[summon] Already up to date (${currentVersion}).`);
    return;
  }

  console.log(`[summon] New version available: ${latestVersion}`);

  // Find the right asset for this platform/arch
  const assetName = getAssetName();
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(
      `No release asset found for ${assetName}.\n` +
      `Available assets: ${release.assets.map((a) => a.name).join(", ")}`
    );
  }

  // Download the new binary — stream to a temp file to avoid buffering in memory
  console.log(`[summon] Downloading ${assetName}...`);
  const downloadRes = await fetch(asset.browser_download_url);
  if (!downloadRes.ok) {
    throw new Error(`Download failed: ${downloadRes.status}`);
  }

  const execPath = process.execPath;
  const tmpPath = `${execPath}.tmp`;
  const backupPath = `${execPath}.bak`;

  await Bun.write(tmpPath, downloadRes);
  chmodSync(tmpPath, 0o755);

  // Swap binaries with backup for rollback safety
  try {
    if (existsSync(backupPath)) unlinkSync(backupPath);
    renameSync(execPath, backupPath);
    renameSync(tmpPath, execPath);
    unlinkSync(backupPath);
  } catch (err) {
    // Try to restore from backup
    if (existsSync(backupPath) && !existsSync(execPath)) {
      try {
        renameSync(backupPath, execPath);
      } catch {
        // If restore fails, tell user where backup is
      }
    }
    // Clean up temp file
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch {}
    }
    const detail = existsSync(backupPath) ? `\nBackup is at: ${backupPath}` : "";
    throw new Error(`Failed to replace binary: ${err}${detail}`);
  }

  console.log(`[summon] Updated to ${latestVersion}. Restart summon to use the new version.`);
}
