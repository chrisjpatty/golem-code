import type { ServerWebSocket } from "bun";
import { query, type Query, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import type { GolemCommand, GolemEvent, GolemQuestion } from "@golem-code/types";
import { sdkMessageToGolemEvents } from "./transform";

const PORT = Number(process.env.GOLEM_PORT) || 4747;

type WSData = { id: string };

const clients = new Set<ServerWebSocket<WSData>>();
let activeQuery: Query | null = null;

// -- Pending request system --
// When canUseTool fires, we store a resolver here and wait for the frontend to respond.

type PendingRequest = {
  resolve: (result: PermissionResult) => void;
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

function canUseTool(
  toolName: string,
  input: Record<string, unknown>,
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

  // Regular tool — ask for permission
  broadcast({
    type: "permission:request",
    requestId,
    toolName,
    toolInput: input,
    timestamp: now,
  });

  return new Promise((resolve) => {
    pendingRequests.set(requestId, { resolve });
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
      canUseTool: (toolName, input, _options) => canUseTool(toolName, input),
      includePartialMessages: true,
      env: { ...process.env, CLAUDECODE: undefined },
    },
  });

  activeQuery = q;

  try {
    for await (const message of q) {
      if (activeQuery !== q) break;

      const events = sdkMessageToGolemEvents(message);
      for (const event of events) {
        broadcast(event);
      }
    }
  } catch (err) {
    console.error("[golem] Query error:", err);
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

    case "permission:response": {
      const pending = pendingRequests.get(cmd.requestId);
      if (!pending) {
        console.warn(`[golem] No pending permission request: ${cmd.requestId}`);
        break;
      }
      pendingRequests.delete(cmd.requestId);
      if (cmd.allow) {
        pending.resolve({ behavior: "allow" });
      } else {
        pending.resolve({ behavior: "deny", message: "User denied" });
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
      try {
        const cmd = JSON.parse(String(raw)) as GolemCommand;
        handleCommand(cmd);
      } catch {
        console.error("[golem] Invalid command:", raw);
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
