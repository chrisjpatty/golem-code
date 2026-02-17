import type { ServerWebSocket } from "bun";
import { query, type Query, type PermissionResult, type PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { GolemCommand, GolemEvent, GolemQuestion } from "@golem-code/types";
import { sdkMessageToGolemEvents } from "./transform";
import * as stt from "./stt";
// TTS/summarization disabled temporarily
// import * as tts from "./tts";
// import { summarizeResponse, summarizeToolIntent } from "./summarizer";

const PORT = Number(process.env.GOLEM_PORT) || 4747;

// Binary protocol headers
const HEADER_MIC_AUDIO = 0x01; // client → server: Int16LE PCM
const HEADER_TTS_AUDIO = 0x02; // server → client: Float32LE PCM

type WSData = { id: string };

const clients = new Set<ServerWebSocket<WSData>>();
let activeQuery: Query | null = null;
let currentSessionId: string | null = null;

// -- Pending request system --
// When canUseTool fires, we store a resolver here and wait for the frontend to respond.

type PendingRequest = {
  resolve: (result: PermissionResult) => void;
  input: Record<string, unknown>;
  suggestions?: PermissionUpdate[];
  toolUseID: string;
};

const pendingRequests = new Map<string, PendingRequest>();

// For AskUserQuestion, we store the original input so we can inject answers.
type PendingQuestion = {
  resolve: (result: PermissionResult) => void;
  originalInput: Record<string, unknown>;
};

const pendingQuestions = new Map<string, PendingQuestion>();

function broadcast(event: GolemEvent) {
  const json = JSON.stringify(event);
  for (const ws of clients) {
    ws.send(json);
  }
}

function broadcastBinary(data: ArrayBuffer) {
  for (const ws of clients) {
    ws.send(data);
  }
}

// Voice/TTS/speech pipeline disabled temporarily
// function sendAudioChunks(...) { ... }
// function speakText(...) { ... }
// function playSpeech(...) { ... }

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

function canUseTool(
  toolName: string,
  input: Record<string, unknown>,
  options: {
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
  const labeledSuggestions = options.suggestions?.map((s) => ({
    update: s,
    label: labelForSuggestion(s),
  }));

  // Regular tool — ask for permission
  broadcast({
    type: "permission:request",
    requestId,
    toolName,
    toolInput: input,
    ...(options.decisionReason ? { decisionReason: options.decisionReason } : {}),
    ...(labeledSuggestions?.length ? { suggestions: labeledSuggestions } : {}),
    timestamp: now,
  });

  return new Promise((resolve) => {
    pendingRequests.set(requestId, {
      resolve,
      input,
      suggestions: options.suggestions,
      toolUseID: options.toolUseID,
    });
  });
}

async function runQuery(prompt: string) {
  if (activeQuery) {
    activeQuery.close();
    activeQuery = null;
  }

  // Clear any stale pending requests
  for (const [id, req] of pendingRequests) {
    req.resolve({ behavior: "deny", message: "Query cancelled" });
  }
  pendingRequests.clear();
  for (const [id, req] of pendingQuestions) {
    req.resolve({ behavior: "deny", message: "Query cancelled" });
  }
  pendingQuestions.clear();

  console.log(`[golem] Starting query: "${prompt}"`);

  const q = query({
    prompt,
    options: {
      permissionMode: "default",
      canUseTool: (toolName, input, options) => canUseTool(toolName, input, options),
      includePartialMessages: true,
      env: { ...process.env, CLAUDECODE: undefined },
      ...(currentSessionId ? { resume: currentSessionId } : {}),
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

        // Voice: disabled temporarily
        // if (event.type === "tool:start") {
        //   speakText(
        //     event.toolName,
        //     "tool_intent",
        //     () => summarizeToolIntent(event.toolName, event.input),
        //   );
        // }
        // if (event.type === "session:result" && event.success && event.result) {
        //   speakText(
        //     event.result,
        //     "response",
        //     () => summarizeResponse(event.result!),
        //   );
        // }
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
      // Inject answers into the original tool input so the SDK runs the tool with them
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
      for (const [, req] of pendingRequests) {
        req.resolve({ behavior: "deny", message: "Conversation cleared" });
      }
      pendingRequests.clear();
      for (const [, req] of pendingQuestions) {
        req.resolve({ behavior: "deny", message: "Conversation cleared" });
      }
      pendingQuestions.clear();
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
    // Slice past the 1-byte header to get aligned Int16 PCM data
    const pcmBytes = data.slice(1);
    const pcm = new Int16Array(pcmBytes);
    stt.feedAudio(pcm);
  }
}

const server = Bun.serve<WSData>({
  port: PORT,
  fetch(req, server) {
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

    return new Response("golem-code agent server", { status: 200 });
  },
  websocket: {
    open(ws) {
      clients.add(ws);
      console.log(`[golem] Client connected (${clients.size} total)`);
    },
    message(ws, raw) {
      // Binary messages → audio processing
      if (typeof raw !== "string") {
        // Bun delivers binary as Buffer (Uint8Array subclass)
        let ab: ArrayBuffer;
        if (raw instanceof ArrayBuffer) {
          ab = raw;
        } else {
          // Buffer / Uint8Array — copy to a clean ArrayBuffer
          ab = new Uint8Array(raw).buffer;
        }
        handleBinaryMessage(ab);
        return;
      }

      // String messages → JSON command handling
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
    close(ws) {
      clients.delete(ws);
      console.log(`[golem] Client disconnected (${clients.size} total)`);
    },
  },
});

console.log(`[golem] Server running on http://localhost:${server.port}`);
console.log(`[golem] WebSocket endpoint: ws://localhost:${server.port}/ws`);
