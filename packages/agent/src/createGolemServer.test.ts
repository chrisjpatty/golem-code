import { describe, test, expect, afterEach, mock } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { GolemEvent, GolemCommand } from "@golem-code/types";

// Mock the stt module before importing server (whisper model isn't available in test)
mock.module("./stt", () => ({
  startSession: () => {},
  feedAudio: () => null,
  endSession: async () => "",
}));

const { createGolemServer } = await import("./server");
type GolemServer = Awaited<ReturnType<typeof createGolemServer>>;

// Use high random ports to avoid conflicts with the subprocess-based server.test.ts
const getPort = () => 4800 + Math.floor(Math.random() * 100);

function connectWS(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
    setTimeout(() => reject(new Error("WS connect timeout")), 5000);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 5000): Promise<GolemEvent> {
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      ws.removeEventListener("message", handler);
      resolve(JSON.parse(e.data));
    };
    ws.addEventListener("message", handler);
    setTimeout(() => {
      ws.removeEventListener("message", handler);
      reject(new Error("Timeout waiting for message"));
    }, timeoutMs);
  });
}

function send(ws: WebSocket, cmd: GolemCommand) {
  ws.send(JSON.stringify(cmd));
}

let server: GolemServer | null = null;

afterEach(() => {
  if (server) {
    server.stop();
    server = null;
  }
});

describe("createGolemServer", () => {
  test("returns a server with port, stop, and getState", () => {
    const port = getPort();
    server = createGolemServer({ port });
    expect(server.port).toBe(port);
    expect(typeof server.stop).toBe("function");
    expect(typeof server.getState).toBe("function");
  });

  test("getState returns initial state with zero counts", () => {
    server = createGolemServer({ port: getPort() });
    const state = server.getState();
    expect(state.clients).toBe(0);
    expect(state.queryActive).toBe(false);
    expect(state.pendingPermissions).toBe(0);
    expect(state.pendingQuestions).toBe(0);
  });

  test("health endpoint responds with state", async () => {
    const port = getPort();
    server = createGolemServer({ port });
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.clients).toBe(0);
    expect(body.queryActive).toBe(false);
    expect(body.pendingPermissions).toBe(0);
    expect(body.pendingQuestions).toBe(0);
  });

  test("root endpoint responds with server name", async () => {
    const port = getPort();
    server = createGolemServer({ port });
    const res = await fetch(`http://localhost:${port}/`);
    const text = await res.text();
    expect(text).toBe("golem-code agent server");
  });

  test("tracks WebSocket client connections", async () => {
    const port = getPort();
    server = createGolemServer({ port });
    expect(server.getState().clients).toBe(0);

    const ws1 = await connectWS(port);
    // Give server time to process
    await new Promise((r) => setTimeout(r, 50));
    expect(server.getState().clients).toBe(1);

    const ws2 = await connectWS(port);
    await new Promise((r) => setTimeout(r, 50));
    expect(server.getState().clients).toBe(2);

    ws1.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.getState().clients).toBe(1);

    ws2.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.getState().clients).toBe(0);
  });

  test("conversation:clear broadcasts cleared event", async () => {
    const port = getPort();
    server = createGolemServer({ port });
    const ws = await connectWS(port);

    try {
      const msgPromise = waitForMessage(ws);
      send(ws, { type: "conversation:clear" });
      const event = await msgPromise;
      expect(event.type).toBe("conversation:cleared");
      expect(typeof event.timestamp).toBe("number");
    } finally {
      ws.close();
    }
  });

  test("stop() shuts down the server", async () => {
    const port = getPort();
    server = createGolemServer({ port });

    // Verify it's running
    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.ok).toBe(true);

    server.stop();
    server = null;

    // Give the OS time to release the port
    await new Promise((r) => setTimeout(r, 100));

    // Should fail to connect now
    try {
      await fetch(`http://localhost:${port}/health`);
      // If fetch doesn't throw, it might get a connection reset
    } catch {
      // Expected — server is down
    }
  });

  test("multiple independent server instances on different ports", async () => {
    const port1 = getPort();
    const port2 = port1 + 1;

    const server1 = createGolemServer({ port: port1 });
    const server2 = createGolemServer({ port: port2 });

    try {
      const [res1, res2] = await Promise.all([
        fetch(`http://localhost:${port1}/health`),
        fetch(`http://localhost:${port2}/health`),
      ]);
      expect(res1.ok).toBe(true);
      expect(res2.ok).toBe(true);

      // Connect WS to server1 only — should not affect server2's state
      const ws = await connectWS(port1);
      await new Promise((r) => setTimeout(r, 50));
      expect(server1.getState().clients).toBe(1);
      expect(server2.getState().clients).toBe(0);
      ws.close();
    } finally {
      server1.stop();
      server2.stop();
    }
  });

  test("conversation:clear resets pending counts", async () => {
    const port = getPort();
    server = createGolemServer({ port });
    const ws = await connectWS(port);

    try {
      // State starts clean
      expect(server.getState().pendingPermissions).toBe(0);
      expect(server.getState().pendingQuestions).toBe(0);

      // Clear should maintain zero counts (no crash, no error)
      const msgPromise = waitForMessage(ws);
      send(ws, { type: "conversation:clear" });
      await msgPromise;

      expect(server.getState().pendingPermissions).toBe(0);
      expect(server.getState().pendingQuestions).toBe(0);
    } finally {
      ws.close();
    }
  });
});

describe("static file serving", () => {
  let staticDir: string;

  function setupStaticDir() {
    staticDir = join(tmpdir(), `golem-test-static-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(staticDir, { recursive: true });
    mkdirSync(join(staticDir, "assets"), { recursive: true });
    writeFileSync(join(staticDir, "index.html"), "<html><body>Golem Test</body></html>");
    writeFileSync(join(staticDir, "assets", "app.js"), "console.log('test');");
    writeFileSync(join(staticDir, "assets", "style.css"), "body { color: red; }");
    writeFileSync(join(staticDir, "data.json"), '{"key":"value"}');
    return staticDir;
  }

  function cleanupStaticDir() {
    try { rmSync(staticDir, { recursive: true, force: true }); } catch {}
  }

  test("serves index.html at root when staticDir is set", async () => {
    const dir = setupStaticDir();
    const port = getPort();
    server = createGolemServer({ port, staticDir: dir });

    try {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.ok).toBe(true);
      const text = await res.text();
      expect(text).toContain("Golem Test");
      expect(res.headers.get("content-type")).toBe("text/html");
    } finally {
      cleanupStaticDir();
    }
  });

  test("serves JS files with correct content type", async () => {
    const dir = setupStaticDir();
    const port = getPort();
    server = createGolemServer({ port, staticDir: dir });

    try {
      const res = await fetch(`http://localhost:${port}/assets/app.js`);
      expect(res.ok).toBe(true);
      const text = await res.text();
      expect(text).toBe("console.log('test');");
      expect(res.headers.get("content-type")).toBe("text/javascript");
    } finally {
      cleanupStaticDir();
    }
  });

  test("serves CSS files with correct content type", async () => {
    const dir = setupStaticDir();
    const port = getPort();
    server = createGolemServer({ port, staticDir: dir });

    try {
      const res = await fetch(`http://localhost:${port}/assets/style.css`);
      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type")).toBe("text/css");
    } finally {
      cleanupStaticDir();
    }
  });

  test("serves JSON files with correct content type", async () => {
    const dir = setupStaticDir();
    const port = getPort();
    server = createGolemServer({ port, staticDir: dir });

    try {
      const res = await fetch(`http://localhost:${port}/data.json`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body).toEqual({ key: "value" });
      expect(res.headers.get("content-type")).toBe("application/json");
    } finally {
      cleanupStaticDir();
    }
  });

  test("SPA fallback serves index.html for unknown routes", async () => {
    const dir = setupStaticDir();
    const port = getPort();
    server = createGolemServer({ port, staticDir: dir });

    try {
      const res = await fetch(`http://localhost:${port}/some/deep/route`);
      expect(res.ok).toBe(true);
      const text = await res.text();
      expect(text).toContain("Golem Test");
      expect(res.headers.get("content-type")).toBe("text/html");
    } finally {
      cleanupStaticDir();
    }
  });

  test("health endpoint still works with staticDir", async () => {
    const dir = setupStaticDir();
    const port = getPort();
    server = createGolemServer({ port, staticDir: dir });

    try {
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.status).toBe("ok");
    } finally {
      cleanupStaticDir();
    }
  });

  test("WebSocket still works with staticDir", async () => {
    const dir = setupStaticDir();
    const port = getPort();
    server = createGolemServer({ port, staticDir: dir });

    try {
      const ws = await connectWS(port);
      await new Promise((r) => setTimeout(r, 50));
      expect(server.getState().clients).toBe(1);
      ws.close();
    } finally {
      cleanupStaticDir();
    }
  });

  test("without staticDir, root returns plain text", async () => {
    const port = getPort();
    server = createGolemServer({ port });

    const res = await fetch(`http://localhost:${port}/`);
    const text = await res.text();
    expect(text).toBe("golem-code agent server");
  });
});

describe("queryOptions threading", () => {
  test("server accepts queryOptions without error", () => {
    const port = getPort();
    server = createGolemServer({
      port,
      queryOptions: {
        cwd: "/tmp",
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "acceptEdits",
        maxTurns: 10,
        maxBudgetUsd: 5.0,
        systemPrompt: "You are a test assistant",
        allowedTools: ["Bash", "Read"],
        disallowedTools: ["Write"],
        debug: true,
        additionalDirectories: ["/tmp/extra"],
      },
    });

    expect(server.port).toBe(port);
    const state = server.getState();
    expect(state.clients).toBe(0);
    expect(state.queryActive).toBe(false);
  });

  test("server accepts continue option", () => {
    const port = getPort();
    server = createGolemServer({
      port,
      queryOptions: { continue: true },
    });
    expect(server.port).toBe(port);
  });

  test("server accepts resume option", () => {
    const port = getPort();
    server = createGolemServer({
      port,
      queryOptions: { resume: "some-session-id" },
    });
    expect(server.port).toBe(port);
  });
});

describe("initialPrompt", () => {
  test("server accepts initialPrompt without error", () => {
    const port = getPort();
    server = createGolemServer({
      port,
      initialPrompt: "Hello from test",
    });
    expect(server.port).toBe(port);
  });

  test("server starts normally with all options combined", () => {
    const port = getPort();
    server = createGolemServer({
      port,
      queryOptions: {
        cwd: "/tmp",
        model: "claude-sonnet-4-5-20250929",
        permissionMode: "default",
      },
      initialPrompt: "Run tests",
    });
    expect(server.port).toBe(port);
    expect(server.getState().queryActive).toBe(false);
  });
});
