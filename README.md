# Summon

A 3D animated companion overlay for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Summon renders a procedurally generated golem face in a floating native window that reacts in real-time to your coding agent's activity — tool calls, subagent spawns, permission requests, and more.

Use Claude Code like you normally would. Summon just gives it a face.

## What it does

When you run `summon` instead of `claude`, you get the full Claude Code experience in your terminal plus a floating 3D face overlay that visually reflects what the agent is doing:

- **Eyes glow** when the agent is actively thinking
- **Smiles** during tool use (file edits, bash commands, searches)
- **Opens mouth** when waiting for your permission to proceed
- **Spawns smaller faces** when the agent launches subagents
- **Goes dark** when idle, waiting for your next prompt

Each agent gets a unique procedurally generated face based on its session ID — no two look alike.

### Multi-instance support

Run multiple `summon` sessions and they automatically discover each other. The first instance becomes the primary and hosts the overlay. Additional instances connect as peers, and their faces appear alongside the first in the same overlay window — each with a distinct color.

Click any face in the overlay to focus that agent's terminal window.

## Requirements

- **macOS** (the native overlay window uses macOS-specific APIs)
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** installed and configured

## Installation

```bash
curl -fsSL https://raw.githubusercontent.com/chrisjpatty/golem-code/main/install.sh | sh
```

This downloads the latest `summon` binary for your Mac and installs it to `/usr/local/bin`. Set `SUMMON_INSTALL_DIR` to install elsewhere:

```bash
SUMMON_INSTALL_DIR=~/.local/bin curl -fsSL https://raw.githubusercontent.com/chrisjpatty/golem-code/main/install.sh | sh
```

### Install the Claude Code plugin

After installing the binary, open Claude Code and install the plugin:

```
/plugin marketplace add chrisjpatty/golem-code
/plugin install golem-code
```

This registers the hooks that let Summon see what Claude Code is doing. You only need to do this once.

### Updating

```bash
summon --update
```

This downloads the latest release and replaces the current binary in-place.

## Usage

Summon is a drop-in wrapper for Claude Code. Use it exactly as you would use `claude`:

```bash
# Start a new session
summon

# Start with an initial prompt
summon "Fix the failing tests in src/utils"

# Continue the most recent conversation
summon -c

# Resume a specific session
summon -r <session-id>

# Work in a different directory
summon --cwd ~/my-project

# Open the face in a browser tab instead of the native overlay
summon --browser

# Forward flags to Claude Code (everything after -- is passed through)
summon -- --model sonnet
```

### CLI reference

```
summon [options] [prompt]

Options:
  -p, --prompt <text>         Initial prompt to send to Claude Code
  -c, --continue              Continue the most recent conversation
  -r, --resume <session-id>   Resume a specific session
  --cwd <dir>                 Working directory (default: current directory)
  --port <port>               Server port (default: 6661)
  --browser                   Open face in browser instead of native overlay
  --no-open                   Don't auto-open the browser/overlay
  --update                    Update summon to the latest version
  -v, --version               Show version
  -h, --help                  Show help
  --                          Pass remaining arguments to Claude Code
```

## How it works

Summon sits between you and Claude Code:

1. **Spawns Claude Code** in a PTY (pseudo-terminal), so your terminal experience is unchanged
2. **Runs an HTTP/WebSocket server** that receives hook events from a bundled Claude Code plugin
3. **Launches a native overlay window** (Tauri/Rust) that renders the 3D face via a WebGL frontend
4. **Translates hook events into facial expressions** — tool starts trigger smiles, permission requests trigger the "oh" face, idle triggers eyes-off

The overlay window is fully transparent and click-through by default. It only captures mouse events when your cursor is directly over a face, allowing you to click faces to focus their terminal or drag to reposition the overlay.

### Event flow

| Claude Code event | Golem face behavior |
|---|---|
| User sends prompt | Eyes glow on |
| Tool starts (file edit, bash, etc.) | Mouth smiles |
| Tool finishes | Mouth returns to neutral |
| Permission requested | Mouth opens "oh", environment dims |
| Subagent spawned | Small child face appears, wanders nearby |
| Subagent finishes | Child face fades out |
| Turn ends (agent idle) | Eyes glow off, neutral expression |

### Peer discovery

When you launch a second `summon` instance, it checks `~/.golem/instances/` for a running primary. If one is found, the new instance connects as a peer over WebSocket and forwards its events — the primary's overlay renders both faces side by side. Each peer gets assigned a unique color from a 12-color palette.

### Browser mode

If you don't want the native overlay or are on a non-macOS platform, use `--browser` to open the face in a browser tab instead:

```bash
summon --browser
```

The 3D face renders identically in the browser — you just lose the floating always-on-top overlay behavior.

## Troubleshooting

### The overlay doesn't appear
- Check that port 6661 is available (or use `--port` to pick another)
- Try `summon --browser` to verify the face renders in a browser

### Faces aren't reacting to agent activity
- Make sure the Claude Code plugin is installed: run `/plugin install golem-code` inside Claude Code
- Check that Summon's server is running — look for `[summon] Golem server: http://localhost:6661` in your terminal output

### Multiple instances aren't connecting
- Each instance registers in `~/.golem/instances/`. Stale entries from crashed sessions are cleaned up automatically, but you can manually clear that directory if needed.

## Building from source

### Requirements

- **[Bun](https://bun.sh/)** runtime
- **[Rust](https://rustup.rs/)** toolchain (for the native overlay)

### Build

```bash
# Install dependencies
bun install

# Build everything (frontend + overlay + CLI)
bun run build

# Skip the Rust overlay build (faster, browser-only mode)
bun run build --skip-overlay
```

This produces a single compiled binary at `dist/summon`. The overlay binary is embedded inside it and extracted to `~/.golem/bin/` on first run.

### Development

```bash
# Run from source (builds frontend on demand, uses local overlay binary)
bun run summon

# Run with Vite dev server for frontend hot-reload
bun run summon -- --dev
```

### Project structure

```
packages/
  cli/          Bun CLI — PTY spawning, HTTP/WS server, instance registry, peer coordination
  frontend/     React Three Fiber 3D face rendering — procedural geometry, expressions, post-processing
  overlay/      Tauri/Rust native macOS overlay — transparent window, CoreGraphics cursor tracking
  plugin/       Claude Code plugin — hook definitions that POST events to the CLI server
  types/        Shared TypeScript types — event protocol, commands, color palette
```
