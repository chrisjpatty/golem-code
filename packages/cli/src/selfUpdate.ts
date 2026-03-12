/**
 * Self-update: downloads the latest summon binary from GitHub Releases
 * and replaces the current executable in-place.
 */

import { existsSync, unlinkSync, chmodSync, copyFileSync } from "fs";

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

/**
 * Non-blocking startup check: fetches the latest release and prints a
 * notice if the running binary is behind.  Swallows all errors silently
 * so it never interferes with normal startup.
 */
export async function checkForUpdate(currentVersion: string): Promise<void> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(3000), // don't hang startup
    });
    if (!res.ok) return;

    const release = (await res.json()) as Release;
    const latestVersion = release.tag_name.replace(/^v/, "");
    if (latestVersion === currentVersion) return;

    const line = "─".repeat(52);
    console.log("");
    console.log(`  ${line}`);
    console.log(`  ⬆  Update available: ${currentVersion} → ${latestVersion}`);
    console.log(`     Run \x1b[1msummon --update\x1b[0m to upgrade`);
    console.log(`  ${line}`);
    console.log("");
  } catch {
    // Network errors, timeouts, JSON parse failures — all silently ignored.
  }
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

  await Bun.write(tmpPath, downloadRes);
  chmodSync(tmpPath, 0o755);

  // Overwrite the binary in place by copying contents onto the existing path.
  // Using rename would move the running executable's inode, which can cause
  // the process to hang or crash on macOS before it finishes.
  try {
    copyFileSync(tmpPath, execPath);
    unlinkSync(tmpPath);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try { unlinkSync(tmpPath); } catch {}
    }
    throw new Error(`Failed to replace binary: ${err}`);
  }

  console.log(`[summon] Updated to ${latestVersion}. Restart summon to use the new version.`);
}
