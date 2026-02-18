import type { ServerWebSocket } from "bun";
import { query, type Query, type PermissionResult, type PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { GolemCommand, GolemEvent, GolemQuestion } from "@golem-code/types";
import { HEADER_MIC_AUDIO } from "@golem-code/types";
import { sdkMessageToGolemEvents } from "./transform";
import * as stt from "./stt";

type WSData = { id: string };

type PendingRequest = {
  resolve: (result: PermissionResult) => void;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  toolUseID: string;
};

type PendingQuestion = {
  resolve: (result: PermissionResult) => void;
  originalInput: Record<string, unknown>;
};

export type GolemQueryOptions = {
  /** Working directory for the Claude session. Defaults to process.cwd(). */
  cwd?: string;
  /** Claude model to use. */
  model?: string;
  /** Permission mode for tool execution. */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";
  /** Maximum conversation turns. */
  maxTurns?: number;
  /** Maximum budget in USD. */
  maxBudgetUsd?: number;
  /** System prompt override. */
  systemPrompt?: string;
  /** Tools to auto-allow. */
  allowedTools?: string[];
  /** Tools to disallow. */
  disallowedTools?: string[];
  /** Continue the most recent conversation. */
  continue?: boolean;
  /** Resume a specific session ID. */
  resume?: string;
  /** Enable debug logging. */
  debug?: boolean;
  /** Additional directories to allow access. */
  additionalDirectories?: string[];
};

export type GolemServerOptions = {
  port?: number;
  /** Directory to serve static frontend files from. */
  staticDir?: string;
  /** SDK query options to pass through to every query. */
  queryOptions?: GolemQueryOptions;
  /** Initial prompt to run when the first client connects. */
  initialPrompt?: string;
};

export type GolemServer = {
  readonly port: number;
  stop: () => void;
  getState: () => {
    clients: number;
    queryActive: boolean;
    pendingPermissions: number;
    pendingQuestions: number;
  };
};

function destinationLabel(dest: string): string {
  switch (dest) {
    case "session": return "this session";
    case "projectSettings": return "project settings";
    case "userSettings": return "user settings";
    case "localSettings": return "local settings";
    case "cliArg": return "CLI args";
    default: return dest;
  }
}

function labelForSuggestion(s: PermissionUpdate): string {
  switch (s.type) {
    case "addRules": {
      const behavior = s.behavior === "allow" ? "Allow" : s.behavior;
      const tools = s.rules.map((r) => r.toolName).join(", ");
      return `Always ${behavior} ${tools} (${destinationLabel(s.destination)})`;
    }
    case "replaceRules": {
      const tools = s.rules.map((r) => r.toolName).join(", ");
      return `Replace rules for ${tools} (${destinationLabel(s.destination)})`;
    }
    case "removeRules": {
      const tools = s.rules.map((r) => r.toolName).join(", ");
      return `Remove rules for ${tools} (${destinationLabel(s.destination)})`;
    }
    case "setMode":
      return `Set permission mode to ${s.mode} (${destinationLabel(s.destination)})`;
    case "addDirectories": {
      const dirs = s.directories.join(", ");
      return `Allow directories: ${dirs} (${destinationLabel(s.destination)})`;
    }
    case "removeDirectories": {
      const dirs = s.directories.join(", ");
      return `Remove directories: ${dirs} (${destinationLabel(s.destination)})`;
    }
    default:
      return "Update permissions";
  }
}

export function createGolemServer(options: GolemServerOptions = {}): GolemServer {
  const port = options.port ?? (Number(process.env.GOLEM_PORT) || 4747);
  const staticDir = options.staticDir ?? null;
  const qOpts = options.queryOptions ?? {};
  let initialPrompt = options.initialPrompt ?? null;

  const clients = new Set<ServerWebSocket<WSData>>();
  let activeQuery: Query | null = null;
  let currentSessionId: string | null = null;
  const pendingRequests = new Map<string, PendingRequest>();
  const pendingQuestions = new Map<string, PendingQuestion>();

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

  function broadcast(event: GolemEvent) {
    const json = JSON.stringify(event);
    for (const ws of clients) {
      ws.send(json);
    }
  }

  function canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    opts: {
      signal: AbortSignal;
      suggestions?: PermissionUpdate[];
      blockedPath?: string;
      decisionReason?: string;
      toolUseID: string;
      agentID?: string;
    },
  ): Promise<PermissionResult> {
    const requestId = crypto.randomUUID();
    const now = Date.now();

    // Special case: AskUserQuestion — send the questions to the frontend
    if (toolName === "AskUserQuestion") {
      const rawQuestions = input.questions as any[];
      const questions: GolemQuestion[] = rawQuestions.map((q: any) => ({
        question: q.question,
        header: q.header,
        options: q.options.map((o: any) => ({ label: o.label, description: o.description })),
        multiSelect: q.multiSelect,
      }));

      broadcast({
        type: "question:ask",
        requestId,
        questions,
        timestamp: now,
      });

      return new Promise((resolve) => {
        pendingQuestions.set(requestId, { resolve, originalInput: input });
      });
    }

    // Build labeled suggestions for the frontend
    const labeledSuggestions = opts.suggestions?.map((s) => ({
      update: s,
      label: labelForSuggestion(s),
    }));

    // Regular tool — ask for permission
    broadcast({
      type: "permission:request",
      requestId,
      toolName,
      toolInput: input,
      ...(opts.decisionReason ? { decisionReason: opts.decisionReason } : {}),
      ...(labeledSuggestions?.length ? { suggestions: labeledSuggestions } : {}),
      timestamp: now,
    });

    return new Promise((resolve) => {
      pendingRequests.set(requestId, {
        resolve,
        input,
        suggestions: opts.suggestions,
        toolUseID: opts.toolUseID,
      });
    });
  }

  async function runQuery(prompt: string) {
    if (activeQuery) {
      activeQuery.close();
      activeQuery = null;
    }

    clearAllPending("Query cancelled");

    console.log(`[golem] Starting query: "${prompt}"`);

    const q = query({
      prompt,
      options: {
        permissionMode: qOpts.permissionMode ?? "default",
        canUseTool: (toolName, input, opts) => canUseTool(toolName, input, opts),
        includePartialMessages: true,
        env: { ...process.env, CLAUDECODE: undefined },
        ...(currentSessionId ? { resume: currentSessionId } : {}),
        ...(qOpts.cwd ? { cwd: qOpts.cwd } : {}),
        ...(qOpts.model ? { model: qOpts.model } : {}),
        ...(qOpts.maxTurns ? { maxTurns: qOpts.maxTurns } : {}),
        ...(qOpts.maxBudgetUsd ? { maxBudgetUsd: qOpts.maxBudgetUsd } : {}),
        ...(qOpts.allowedTools ? { allowedTools: qOpts.allowedTools } : {}),
        ...(qOpts.disallowedTools ? { disallowedTools: qOpts.disallowedTools } : {}),
        ...(qOpts.debug ? { debug: true } : {}),
        ...(qOpts.additionalDirectories ? { additionalDirectories: qOpts.additionalDirectories } : {}),
        ...(qOpts.systemPrompt ? { systemPrompt: qOpts.systemPrompt } : {}),
        ...(qOpts.continue && !currentSessionId ? { continue: true } : {}),
      },
    });

    activeQuery = q;

    try {
      for await (const message of q) {
        if (activeQuery !== q) break;

        // Capture session ID for conversation continuity
        if ("session_id" in message && message.session_id) {
          if (currentSessionId !== message.session_id) {
            currentSessionId = message.session_id as string;
            console.log(`[golem] Captured session ID: ${currentSessionId}`);
          }
        }

        const events = sdkMessageToGolemEvents(message);
        for (const event of events) {
          broadcast(event);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[golem] Query error:", errMsg);

      // Reset session so the next query starts fresh instead of resuming a crashed session
      currentSessionId = null;

      // Notify the frontend that the query failed
      broadcast({
        type: "session:result",
        sessionId: "",
        success: false,
        errors: [errMsg],
        durationMs: 0,
        totalCostUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        numTurns: 0,
        timestamp: Date.now(),
      });
    } finally {
      if (activeQuery === q) {
        activeQuery = null;
      }
    }
  }

  function handleCommand(cmd: GolemCommand) {
    switch (cmd.type) {
      case "query:start":
        runQuery(cmd.prompt);
        break;

      case "query:stop":
        if (activeQuery) {
          console.log("[golem] Stopping active query");
          activeQuery.close();
          activeQuery = null;
          clearAllPending("Query stopped");
        }
        break;

      case "voice:start":
        stt.startSession(cmd.sampleRate);
        break;

      case "voice:stop": {
        stt.endSession().then((text) => {
          if (text) {
            broadcast({
              type: "stt:transcript",
              text,
              isFinal: true,
              timestamp: Date.now(),
            });
            runQuery(text);
          }
        });
        break;
      }

      case "permission:response": {
        const pending = pendingRequests.get(cmd.requestId);
        if (!pending) {
          console.warn(`[golem] No pending permission request: ${cmd.requestId}`);
          break;
        }
        pendingRequests.delete(cmd.requestId);
        if (cmd.decision === "allow") {
          pending.resolve({
            behavior: "allow",
            updatedInput: pending.input,
            toolUseID: pending.toolUseID,
          });
        } else if (cmd.decision === "allow-always") {
          pending.resolve({
            behavior: "allow",
            updatedInput: pending.input,
            updatedPermissions: pending.suggestions,
            toolUseID: pending.toolUseID,
          });
        } else {
          pending.resolve({
            behavior: "deny",
            message: "User denied",
            toolUseID: pending.toolUseID,
          });
        }
        break;
      }

      case "question:answer": {
        const pending = pendingQuestions.get(cmd.requestId);
        if (!pending) {
          console.warn(`[golem] No pending question: ${cmd.requestId}`);
          break;
        }
        pendingQuestions.delete(cmd.requestId);
        pending.resolve({
          behavior: "allow",
          updatedInput: { ...pending.originalInput, answers: cmd.answers },
        });
        break;
      }

      case "conversation:clear": {
        console.log("[golem] Clearing conversation");
        if (activeQuery) {
          activeQuery.close();
          activeQuery = null;
        }
        clearAllPending("Conversation cleared");
        currentSessionId = null;
        broadcast({ type: "conversation:cleared", timestamp: Date.now() });
        break;
      }
    }
  }

  function handleBinaryMessage(data: ArrayBuffer) {
    const view = new Uint8Array(data);
    if (view.length < 3) return;
    const header = view[0];
    if (header === HEADER_MIC_AUDIO) {
      const pcmBytes = data.slice(1);
      const pcm = new Int16Array(pcmBytes);
      stt.feedAudio(pcm);
    }
  }

  const MIME_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
  };

  const serveConfig = {
    async fetch(req: Request, server: { upgrade: (req: Request, opts: { data: WSData }) => boolean }) {
      const url = new URL(req.url);

      if (url.pathname === "/ws") {
        const id = crypto.randomUUID();
        if (server.upgrade(req, { data: { id } })) {
          return;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (url.pathname === "/health") {
        return Response.json({
          status: "ok",
          clients: clients.size,
          queryActive: activeQuery !== null,
          pendingPermissions: pendingRequests.size,
          pendingQuestions: pendingQuestions.size,
        });
      }

      // Serve static frontend files if a static directory is configured
      if (staticDir) {
        let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
        const fullPath = `${staticDir}${filePath}`;
        const file = Bun.file(fullPath);
        if (await file.exists()) {
          const ext = filePath.slice(filePath.lastIndexOf("."));
          const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
          return new Response(file, {
            headers: { "Content-Type": contentType },
          });
        }
        // SPA fallback: serve index.html for non-file routes
        const indexFile = Bun.file(`${staticDir}/index.html`);
        if (await indexFile.exists()) {
          return new Response(indexFile, {
            headers: { "Content-Type": "text/html" },
          });
        }
      }

      return new Response("golem-code agent server", { status: 200 });
    },
    websocket: {
      open(ws: ServerWebSocket<WSData>) {
        clients.add(ws);
        console.log(`[golem] Client connected (${clients.size} total)`);
        // Auto-run initial prompt on first client connection
        if (initialPrompt) {
          const prompt = initialPrompt;
          initialPrompt = null; // Only run once
          runQuery(prompt);
        }
      },
      message(ws: ServerWebSocket<WSData>, raw: string | ArrayBuffer | Uint8Array) {
        if (typeof raw !== "string") {
          let ab: ArrayBuffer;
          if (raw instanceof ArrayBuffer) {
            ab = raw;
          } else {
            ab = new Uint8Array(raw).buffer;
          }
          handleBinaryMessage(ab);
          return;
        }

        try {
          const cmd = JSON.parse(raw) as GolemCommand;
          try {
            handleCommand(cmd);
          } catch (err) {
            console.error(`[golem] Error handling ${cmd.type}:`, err);
          }
        } catch {
          console.error("[golem] Invalid JSON:", raw);
        }
      },
      close(ws: ServerWebSocket<WSData>) {
        clients.delete(ws);
        console.log(`[golem] Client disconnected (${clients.size} total)`);
      },
    },
  };

  let server: ReturnType<typeof Bun.serve<WSData>>;
  try {
    server = Bun.serve<WSData>({ ...serveConfig, port });
  } catch (err: any) {
    if (err?.code === "EADDRINUSE") {
      console.warn(`[golem] Port ${port} is in use, finding an available port...`);
      server = Bun.serve<WSData>({ ...serveConfig, port: 0 });
    } else {
      throw err;
    }
  }

  console.log(`[golem] Server running on http://localhost:${server.port}`);
  console.log(`[golem] WebSocket endpoint: ws://localhost:${server.port}/ws`);

  return {
    get port() { return server.port; },
    stop: () => server.stop(),
    getState: () => ({
      clients: clients.size,
      queryActive: activeQuery !== null,
      pendingPermissions: pendingRequests.size,
      pendingQuestions: pendingQuestions.size,
    }),
  };
}
