/**
 * Self-update: downloads the latest summon binary from GitHub Releases
 * and replaces the current executable in-place.
 */

import { existsSync, renameSync, unlinkSync, chmodSync } from "fs";

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
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `summon-darwin-${arch}`;
}

export async function selfUpdate(currentVersion: string): Promise<void> {
  console.log(`[summon] Current version: ${currentVersion}`);
  console.log("[summon] Checking for updates...");

  // Fetch latest release info
  let release: Release;
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
    });
    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status}: ${await res.text()}`);
    }
    release = (await res.json()) as Release;
  } catch (err) {
    console.error("[summon] Failed to check for updates:", err);
    process.exit(1);
  }

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
    console.error(`[summon] No release asset found for ${assetName}.`);
    console.error(`[summon] Available assets: ${release.assets.map((a) => a.name).join(", ")}`);
    process.exit(1);
  }

  // Download the new binary
  console.log(`[summon] Downloading ${assetName}...`);
  let data: ArrayBuffer;
  try {
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`);
    }
    data = await res.arrayBuffer();
  } catch (err) {
    console.error("[summon] Download failed:", err);
    process.exit(1);
  }

  // Replace the current binary
  const execPath = process.execPath;
  const backupPath = `${execPath}.bak`;

  try {
    // Move current binary to backup
    if (existsSync(backupPath)) unlinkSync(backupPath);
    renameSync(execPath, backupPath);

    // Write new binary
    await Bun.write(execPath, data);
    chmodSync(execPath, 0o755);

    // Remove backup
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
    console.error("[summon] Failed to replace binary:", err);
    if (existsSync(backupPath)) {
      console.error(`[summon] Backup is at: ${backupPath}`);
    }
    process.exit(1);
  }

  console.log(`[summon] Updated to ${latestVersion}. Restart summon to use the new version.`);
}
