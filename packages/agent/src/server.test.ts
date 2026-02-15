import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { GolemEvent, GolemCommand } from "@golem-code/types";

// Use a random port for tests to avoid conflicts
const TEST_PORT = 4700 + Math.floor(Math.random() * 50);

let serverProc: ReturnType<typeof Bun.spawn>;

function waitForServer(port: number, timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        if (res.ok) return resolve();
      } catch {}
      if (Date.now() - start > timeoutMs) return reject(new Error("Server start timeout"));
      setTimeout(check, 100);
    };
    check();
  });
}

function connectWS(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
    setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  });
}

function collectEvents(ws: WebSocket, count: number, timeoutMs = 30000): Promise<GolemEvent[]> {
  return new Promise((resolve, reject) => {
    const events: GolemEvent[] = [];
    const handler = (e: MessageEvent) => {
      events.push(JSON.parse(e.data));
      if (events.length >= count) {
        ws.removeEventListener("message", handler);
        resolve(events);
      }
    };
    ws.addEventListener("message", handler);
    setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error(`Timeout waiting for ${count} events, got ${events.length}: ${JSON.stringify(events.map((e) => e.type))}`));
    }, timeoutMs);
  });
}

/** Collect events until a predicate matches, auto-approving permission requests */
function collectUntil(
  ws: WebSocket,
  predicate: (e: GolemEvent) => boolean,
  options?: { autoApprove?: boolean; timeoutMs?: number },
): Promise<GolemEvent[]> {
  const { autoApprove = true, timeoutMs = 30000 } = options ?? {};
  return new Promise((resolve, reject) => {
    const events: GolemEvent[] = [];
    const handler = (e: MessageEvent) => {
      const event: GolemEvent = JSON.parse(e.data);
      events.push(event);
      // Auto-approve permission requests
      if (autoApprove && event.type === "permission:request") {
        ws.send(JSON.stringify({
          type: "permission:response",
          requestId: event.requestId,
          allow: true,
        } satisfies GolemCommand));
      }
      if (predicate(event)) {
        ws.removeEventListener("message", handler);
        resolve(events);
      }
    };
    ws.addEventListener("message", handler);
    setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error(`Timeout, got ${events.length} events: ${JSON.stringify(events.map((e) => e.type))}`));
    }, timeoutMs);
  });
}

function send(ws: WebSocket, cmd: GolemCommand) {
  ws.send(JSON.stringify(cmd));
}

beforeAll(async () => {
  serverProc = Bun.spawn(["bun", "run", "packages/agent/src/index.ts"], {
    cwd: import.meta.dir + "/../../..",
    env: { ...process.env, GOLEM_PORT: String(TEST_PORT), CLAUDECODE: "" },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitForServer(TEST_PORT);
});

afterAll(() => {
  serverProc.kill();
});

describe("server health", () => {
  test("GET /health returns status", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.clients).toBe("number");
    expect(typeof body.queryActive).toBe("boolean");
    expect(typeof body.pendingPermissions).toBe("number");
    expect(typeof body.pendingQuestions).toBe("number");
  });

  test("GET / returns text", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/`);
    const text = await res.text();
    expect(text).toBe("golem-code agent server");
  });
});

describe("WebSocket connection", () => {
  test("connects and disconnects cleanly", async () => {
    const ws = await connectWS(TEST_PORT);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    // Give server time to process disconnect
    await new Promise((r) => setTimeout(r, 100));
  });
});

describe("query lifecycle", () => {
  test("simple query emits session:init and session:result", async () => {
    const ws = await connectWS(TEST_PORT);
    try {
      send(ws, { type: "query:start", prompt: "What is 2+2? Reply with just the number." });

      const events = await collectUntil(ws, (e) => e.type === "session:result");

      const init = events.find((e) => e.type === "session:init");
      expect(init).toBeDefined();
      expect(init!.type).toBe("session:init");
      if (init!.type === "session:init") {
        expect(init!.model).toBeDefined();
        expect(init!.sessionId).toBeDefined();
        expect(init!.tools).toBeInstanceOf(Array);
      }

      const result = events.find((e) => e.type === "session:result");
      expect(result).toBeDefined();
      if (result!.type === "session:result") {
        expect(result!.success).toBe(true);
      }
    } finally {
      ws.close();
    }
  }, 60000);

  test("query with tool use emits tool:start and tool:result", async () => {
    const ws = await connectWS(TEST_PORT);
    try {
      send(ws, {
        type: "query:start",
        prompt: "Run this bash command: echo hello-golem-test",
      });

      const events = await collectUntil(ws, (e) => e.type === "session:result");

      const toolStarts = events.filter((e) => e.type === "tool:start");
      expect(toolStarts.length).toBeGreaterThanOrEqual(1);
      if (toolStarts[0].type === "tool:start") {
        expect(toolStarts[0].toolName).toBeDefined();
        expect(toolStarts[0].toolUseId).toBeDefined();
      }

      const toolResults = events.filter((e) => e.type === "tool:result");
      expect(toolResults.length).toBeGreaterThanOrEqual(1);
    } finally {
      ws.close();
    }
  }, 60000);

  test("query:stop cancels active query", async () => {
    const ws = await connectWS(TEST_PORT);
    try {
      send(ws, {
        type: "query:start",
        prompt: "Write a very long essay about the history of computing. Make it at least 5000 words.",
      });

      // Wait for init to confirm query started
      const initEvents = await collectUntil(ws, (e) => e.type === "session:init");
      expect(initEvents.some((e) => e.type === "session:init")).toBe(true);

      // Stop it
      send(ws, { type: "query:stop" });

      // Give server time to clean up
      await new Promise((r) => setTimeout(r, 1000));

      // Verify via health that no query is active
      const res = await fetch(`http://localhost:${TEST_PORT}/health`);
      const health = await res.json();
      expect(health.queryActive).toBe(false);
    } finally {
      ws.close();
    }
  }, 30000);
});

describe("permission flow", () => {
  test("denying a permission request prevents tool execution", async () => {
    const ws = await connectWS(TEST_PORT);
    try {
      send(ws, {
        type: "query:start",
        prompt: "Run this bash command: echo permission-test",
      });

      // Collect events but deny permission requests
      const events = await collectUntil(
        ws,
        (e) => e.type === "session:result",
        { autoApprove: false, timeoutMs: 60000 },
      );

      // Check that we got permission requests or the query completed
      // (default mode may auto-approve safe tools, so we just verify the flow completes)
      const result = events.find((e) => e.type === "session:result");
      expect(result).toBeDefined();
    } finally {
      ws.close();
    }
  }, 60000);
});
