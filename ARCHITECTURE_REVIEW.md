# Architecture Review: golem-code

**Project**: A 3D visualization interface for the Claude Agent SDK — a WebSocket-based monorepo with a Bun agent server and React/Three.js frontend.

## Strengths

The project has several solid architectural qualities worth preserving:

- **Clean dependency graph**: `types` has no deps, `agent` and `frontend` each depend on `types` only. No circular dependencies. Import directions are strictly unidirectional.
- **Shared type contract**: The `@golem-code/types` package acts as a single source of truth for the WebSocket protocol. Both sides consume the same `GolemEvent`/`GolemCommand` union types.
- **Minimal external dependencies**: Only essential packages are used. No unnecessary abstractions or state management libraries.
- **Streaming architecture**: Good use of `requestAnimationFrame` throttling and refs for buffering high-frequency text deltas without excessive re-renders (`App.tsx:70-99`).
- **Transform layer**: `transform.ts` cleanly decouples the SDK message format from the frontend event format, making the frontend resilient to SDK changes.

## Issues and Suggestions

Findings are organized by priority — the first items address structural problems that compound over time, while later items are smaller improvements.

---

### 1. App.tsx is a god component (476 lines)

`packages/frontend/src/App.tsx` handles too many concerns in a single component:

- Streaming text/thinking buffer management (lines 38-99)
- Subagent lifecycle and animation state (lines 174-193, 332-381)
- Permission auto-approval logic (lines 138-165, 301-322)
- Audio playback coordination (lines 101-105, 288-295)
- Voice capture coordination (lines 402-412)
- 3D scene rendering (lines 414-473)
- Output panel entry management (lines 30, 200-276)

**Suggestion**: Extract these into focused custom hooks:

- `useStreamingBuffers` — text/thinking buffer accumulation and rAF flushing
- `useSubagentManager` — subagent spawn/remove/animation lifecycle
- `usePermissions` — auto-approve logic and permission response handling
- `useOutputEntries` — the output entry state machine (append, update, clear)

The `handleEvent` callback would then become a thin dispatcher calling into these hooks, and `App.tsx` would be reduced to composition and layout.

---

### 2. Binary protocol constants are duplicated

The WebSocket binary frame headers are defined independently in three places:

- `packages/agent/src/server.ts:13-14` — `HEADER_MIC_AUDIO = 0x01`, `HEADER_TTS_AUDIO = 0x02`
- `packages/frontend/src/useGolemSocket.ts:4` — `HEADER_TTS_AUDIO = 0x02`
- `packages/frontend/src/audio/useVoiceCapture.ts` — `HEADER_MIC_AUDIO = 0x01`

If a header value changes in one place but not the others, the audio pipeline silently breaks.

**Suggestion**: Export these constants from `@golem-code/types`:

```typescript
// packages/types/src/index.ts
export const HEADER_MIC_AUDIO = 0x01;
export const HEADER_TTS_AUDIO = 0x02;
```

---

### 3. Pending map cleanup logic is duplicated

The pattern of iterating pending requests/questions and resolving them with a deny message appears twice in `server.ts` with identical logic:

- `server.ts:172-179` (in `runQuery`, clearing stale requests before a new query)
- `server.ts:340-347` (in `handleCommand` for `conversation:clear`)

**Suggestion**: Extract to a shared function:

```typescript
function clearAllPending(reason: string) {
  for (const [, req] of pendingRequests) {
    req.resolve({ behavior: "deny", message: reason });
  }
  pendingRequests.clear();
  for (const [, req] of pendingQuestions) {
    req.resolve({ behavior: "deny", message: reason });
  }
  pendingQuestions.clear();
}
```

---

### 4. Server state uses module-level mutable globals

`server.ts:18-40` maintains all state as module-level variables:

```typescript
const clients = new Set<ServerWebSocket<WSData>>();
let activeQuery: Query | null = null;
let currentSessionId: string | null = null;
const pendingRequests = new Map<string, PendingRequest>();
const pendingQuestions = new Map<string, PendingQuestion>();
```

This works for a single-instance server but makes the code untestable in isolation — `server.test.ts` has to spawn a full subprocess and communicate over WebSocket because there's no way to create an independent server instance.

**Suggestion**: Wrap server state and behavior in a class or factory function:

```typescript
function createGolemServer(options: { port: number }) {
  const clients = new Set<ServerWebSocket<WSData>>();
  let activeQuery: Query | null = null;
  // ...
  return { start(), stop(), broadcast(), getState() };
}
```

This enables unit-testing `handleCommand`, `canUseTool`, and `runQuery` without spawning processes.

---

### 5. No WebSocket reconnection in the frontend

`useGolemSocket.ts:58-61` logs disconnection and nulls the ref but makes no attempt to reconnect:

```typescript
ws.onclose = () => {
  console.log("[golem-ws] Disconnected");
  wsRef.current = null;
};
```

If the agent server restarts during development (which `--watch` mode does frequently), the frontend silently dies.

**Suggestion**: Add reconnection with exponential backoff. Also expose connection state so the UI can display a "reconnecting" indicator.

---

### 6. Frontend WebSocket URL is hardcoded

`useGolemSocket.ts:13` defaults to `ws://localhost:4747/ws`. There's no mechanism to configure this without modifying source code, which prevents deploying the frontend separately from the agent.

**Suggestion**: Read from a Vite environment variable:

```typescript
url = import.meta.env.VITE_GOLEM_WS_URL ?? "ws://localhost:4747/ws"
```

---

### 7. No React error boundary

The frontend has no error boundary component. A runtime error in any component (OutputPanel, GolemFace, SubagentFace) will crash the entire React tree with a blank screen. Three.js errors in particular are common during development.

**Suggestion**: Add an error boundary wrapping at minimum the Canvas and OutputPanel, with a fallback UI that shows the error and offers a reload.

---

### 8. Agent SDK dependency is unpinned

`packages/agent/package.json` specifies `"@anthropic-ai/claude-agent-sdk": "latest"`. This means `bun install` can pull a breaking change at any time without warning, and different developers or CI environments may get different versions.

**Suggestion**: Pin to a specific version (e.g., `"^0.1.0"` or exact). Use `bun update` explicitly when upgrading.

---

### 9. No linting or formatting enforcement

There is no ESLint, Prettier, or equivalent configured. For a multi-package TypeScript project, this leads to inconsistent style across files and makes it easy for subtle issues (unused imports, `any` casts, missing exhaustive checks) to accumulate.

**Suggestion**: Add at minimum:
- `biome` or `eslint` with `@typescript-eslint` for catching `any` usage and enforcing exhaustive switch cases
- `prettier` or `biome` formatting
- A root-level `lint` script

The `switch` statements in `server.ts:handleCommand`, `transform.ts:sdkMessageToGolemEvents`, and `App.tsx:handleEvent` would all benefit from exhaustive checking — a new event type added to `GolemEvent` in the types package currently produces no warning if the frontend doesn't handle it.

---

### 10. No CI/CD pipeline

There are no GitHub Actions workflows, pre-commit hooks, or any automated quality gates. Tests exist but are only run manually via `bun test`.

**Suggestion**: Add a minimal CI workflow that runs:
1. `bun install`
2. `tsc --noEmit` (type checking across all packages)
3. `bun test` (existing tests)
4. Lint (once configured)

---

### 11. Frontend has zero test coverage

Only `packages/agent` has tests. The frontend — which contains the most complex state logic (streaming buffers, subagent lifecycle, permission flow) — has none.

**Suggestion**: The hooks extracted in suggestion #1 would be independently testable. Prioritize testing:
- `useStreamingBuffers` — verify buffer flushing and rAF throttling
- `useOutputEntries` — verify the entry state machine for each event type
- `summarizeToolInput` and `formatToolResult` in `OutputPanel.tsx` — pure functions, easy to test

---

### 12. Inline styles throughout frontend components

All frontend components use inline `style={{...}}` objects. `OutputPanel.tsx` alone has ~50 inline style objects. This causes:
- Style objects to be recreated on every render (minor perf issue with virtualized list)
- No reuse of common patterns (font sizes, colors, spacing)
- Difficult to maintain consistency

**Suggestion**: Extract repeated values (colors like `#ff6644`, `#666`, `#888`; font sizes; spacing) into a shared theme/constants file. CSS modules or a `styles` object per component would also work without adding dependencies.

---

### 13. `OutputEntry` type is defined in the frontend, not in the types package

`OutputEntry` (`OutputPanel.tsx:9-20`) is a UI-layer type that mirrors parts of `GolemEvent` but with different shapes. This is fine architecturally — it's a view model. However, it's exported from `OutputPanel.tsx` and imported by `App.tsx`, creating a tight coupling between these two files.

**Suggestion**: If the output entry types are shared across multiple consumers, move them to a separate `types.ts` file within the frontend package. This isn't urgent but would help when splitting `App.tsx`.

---

### 14. Dead code from disabled TTS/summarizer

`server.ts:6-8` has commented-out imports, and lines 55-58 and 212-226 contain commented-out function calls. The `stt.ts`, `tts.ts`, and `summarizer.ts` modules still exist and are still installed as dependencies.

**Suggestion**: Either remove the dead code paths entirely (they're in git history if needed later), or gate them behind a feature flag/environment variable so the code stays live and tested. Commented-out code tends to rot.

---

### 15. `canUseTool` promise can leak if the query is cancelled

When a query is cancelled (`query:stop`), `server.ts:263-267` calls `activeQuery.close()` but doesn't resolve pending promises in `pendingRequests` or `pendingQuestions`. The `clearAllPending` logic only runs at the start of a *new* query (`runQuery`, line 172) or on `conversation:clear`. If no new query is started, those promises remain unresolved forever, which is a memory leak.

**Suggestion**: Clear pending maps in the `query:stop` handler as well:

```typescript
case "query:stop":
  if (activeQuery) {
    activeQuery.close();
    activeQuery = null;
    clearAllPending("Query stopped");
  }
  break;
```
