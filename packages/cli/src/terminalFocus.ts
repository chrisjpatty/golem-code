/**
 * Focus the terminal window that hosts the current process.
 * Uses TERM_PROGRAM env var to identify the terminal app,
 * then activates it via osascript on macOS.
 */

const TERM_PROGRAM_MAP: Record<string, string> = {
  "iTerm.app": "iTerm2",
  "Apple_Terminal": "Terminal",
  "WezTerm": "WezTerm",
  "Alacritty": "Alacritty",
  "vscode": "Visual Studio Code",
  "ghostty": "Ghostty",
};

export function focusMyTerminal(): void {
  if (process.platform !== "darwin") return;

  const termProgram = process.env.TERM_PROGRAM;
  if (!termProgram) return;

  const appName = TERM_PROGRAM_MAP[termProgram];
  if (!appName) return; // Only allow known terminals — prevents injection via TERM_PROGRAM

  try {
    Bun.spawn(
      ["osascript", "-e", `tell application "${appName}" to activate`],
      { stdout: "ignore", stderr: "ignore" },
    );
  } catch {
    // Silently fail
  }
}
