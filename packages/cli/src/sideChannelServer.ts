/**
 * Side-channel server: Bun WebSocket server that broadcasts GolemEvents
 * from the JSONL watcher to browser clients and receives inject commands.
 *
 * Supports multi-instance: peer CLI instances connect via /peer WebSocket
 * and forward their events, which get rebroadcast to all frontend clients.
 */

import type { ServerWebSocket } from "bun";
import { resolve, normalize } from "path";
import type { GolemEvent, GolemCommand, GolemAgentInit } from "@golem-code/types";

type WSData = { id: string; role: "client" | "peer" };

/** Embedded asset entry — data is a Buffer, served from memory */
export type EmbeddedAsset = { data: Buffer; size: number };

export type SideChannelServerOptions = {
  port?: number;
  /** Directory to serve static frontend files from (dev mode) */
  staticDir?: string;
  /** Embedded frontend assets — used when no staticDir is set (compiled binary) */
  embeddedAssets?: Record<string, EmbeddedAsset>;
  /** Called when a client sends an inject command */
  onInject?: (text: string) => void;
  /** Called when a client requests to focus an agent's terminal */
  onFocusAgent?: (agentId: string) => void;
  /** Agent identity for this CLI instance */
  agentInit?: GolemAgentInit;
  /** Called when a hook event is received via POST /hook */
  onHookEvent?: (data: Record<string, unknown>) => void;
};

export type SideChannelServer = {
  readonly port: number;
  broadcast: (event: GolemEvent) => void;
  stop: () => void;
};

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
  ".hdr": "application/octet-stream",
};

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf("."));
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export function createSideChannelServer(
  options: SideChannelServerOptions = {},
): SideChannelServer {
  const port = options.port ?? 4747;
  const staticDir = options.staticDir ?? null;
  const embeddedAssets = options.embeddedAssets ?? null;
  const onInject = options.onInject;
  const onFocusAgent = options.onFocusAgent;
  const onHookEvent = options.onHookEvent;
  const agentInit = options.agentInit ?? null;

  const clients = new Set<ServerWebSocket<WSData>>();
  const peers = new Set<ServerWebSocket<WSData>>();

  // Track all known agent inits so new frontend clients get the full state
  const knownAgents = new Map<string, GolemAgentInit>();

  // Map agentId → peer WebSocket for sending focus requests to peers
  const peerByAgent = new Map<string, ServerWebSocket<WSData>>();
  if (agentInit) {
    knownAgents.set(agentInit.agentId, agentInit);
  }

  /** Broadcast an event to all frontend clients */
  function broadcastToClients(event: GolemEvent) {
    const json = JSON.stringify(event);
    for (const ws of clients) {
      ws.send(json);
    }
  }

  /** Broadcast to clients (the public API used by the local hook transform) */
  function broadcast(event: GolemEvent) {
    broadcastToClients(event);
  }

  function serveEmbedded(pathname: string): Response | null {
    if (!embeddedAssets) return null;

    const key = pathname === "/" ? "/index.html" : pathname;
    const asset = embeddedAssets[key];
    if (asset) {
      return new Response(asset.data, {
        headers: { "Content-Type": getMimeType(key) },
      });
    }

    // SPA fallback
    const index = embeddedAssets["/index.html"];
    if (index) {
      return new Response(index.data, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return null;
  }

  const serveConfig = {
    async fetch(
      req: Request,
      server: {
        upgrade: (req: Request, opts: { data: WSData }) => boolean;
      },
    ) {
      const url = new URL(req.url);

      // Frontend client WebSocket
      if (url.pathname === "/ws") {
        const id = crypto.randomUUID();
        if (server.upgrade(req, { data: { id, role: "client" } })) {
          return;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Peer CLI WebSocket
      if (url.pathname === "/peer") {
        const id = crypto.randomUUID();
        if (server.upgrade(req, { data: { id, role: "peer" } })) {
          return;
        }
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      if (url.pathname === "/hook" && req.method === "POST") {
        try {
          const body = await req.json() as Record<string, unknown>;
          onHookEvent?.(body);
        } catch {
          // Invalid JSON — ignore
        }
        return Response.json({ status: "ok" });
      }

      if (url.pathname === "/health") {
        return Response.json({
          status: "ok",
          clients: clients.size,
          peers: peers.size,
          agents: knownAgents.size,
        });
      }

      // Serve from embedded assets (compiled binary)
      const embedded = serveEmbedded(url.pathname);
      if (embedded) return embedded;

      // Serve from filesystem (dev mode)
      if (staticDir) {
        const filePath = url.pathname === "/" ? "/index.html" : url.pathname;
        const fullPath = resolve(staticDir, "." + normalize(filePath));
        if (!fullPath.startsWith(staticDir)) {
          return new Response("Forbidden", { status: 403 });
        }
        const file = Bun.file(fullPath);
        if (file.size > 0) {
          return new Response(file, {
            headers: { "Content-Type": getMimeType(filePath) },
          });
        }
        // SPA fallback
        const indexFile = Bun.file(resolve(staticDir, "index.html"));
        if (indexFile.size > 0) {
          return new Response(indexFile, {
            headers: { "Content-Type": "text/html" },
          });
        }
      }

      return new Response("golem-code side-channel server", { status: 200 });
    },
    websocket: {
      open(ws: ServerWebSocket<WSData>) {
        if (ws.data.role === "peer") {
          peers.add(ws);
          return;
        }

        // Frontend client — send all known agent inits
        clients.add(ws);
        for (const init of knownAgents.values()) {
          ws.send(JSON.stringify(init));
        }
      },
      message(
        ws: ServerWebSocket<WSData>,
        raw: string | ArrayBuffer | Uint8Array,
      ) {
        if (typeof raw !== "string") return;

        try {
          const msg = JSON.parse(raw);

          // Peer messages: GolemEvents to rebroadcast
          if (ws.data.role === "peer") {
            const event = msg as GolemEvent;
            // Track agent inits/disconnects
            if (event.type === "agent:init") {
              // Reassign color if it's already in use by another agent
              const usedColors = new Set(
                [...knownAgents.values()].map((a) => a.color)
              );
              if (usedColors.has(event.color)) {
                const FACE_COLORS = [
                  "#cc1111", "#1155cc", "#11aa44", "#cc8811", "#8822cc", "#cc1177",
                  "#11aaaa", "#cc5511", "#4466cc", "#44aa11", "#aa1166", "#888888",
                ];
                const available = FACE_COLORS.filter((c) => !usedColors.has(c));
                if (available.length > 0) {
                  event.color = available[Math.floor(Math.random() * available.length)];
                }
              }
              knownAgents.set(event.agentId, event);
              peerByAgent.set(event.agentId, ws);
            } else if (event.type === "agent:disconnect") {
              knownAgents.delete(event.agentId);
              peerByAgent.delete(event.agentId);
            }
            broadcastToClients(event);
            return;
          }

          // Client messages: commands
          const cmd = msg as GolemCommand;
          if (cmd.type === "inject" && onInject) {
            onInject(cmd.text);
          } else if (cmd.type === "focus:agent") {
            // Check if this is for a peer agent
            const peerWs = peerByAgent.get(cmd.agentId);
            if (peerWs) {
              // Forward focus request to the peer
              peerWs.send(JSON.stringify({ type: "focus:request" }));
            } else if (onFocusAgent) {
              // It's for the primary agent
              onFocusAgent(cmd.agentId);
            }
          }
        } catch {
          // Invalid JSON — ignore
        }
      },
      close(ws: ServerWebSocket<WSData>) {
        if (ws.data.role === "peer") {
          peers.delete(ws);
          // Clean up agentId → peer mapping
          for (const [agentId, peerWs] of peerByAgent) {
            if (peerWs === ws) {
              peerByAgent.delete(agentId);
              break;
            }
          }
          return;
        }
        clients.delete(ws);
      },
    },
  };

  let server: ReturnType<typeof Bun.serve<WSData>>;
  const MAX_PORT_ATTEMPTS = 20;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt++) {
    try {
      server = Bun.serve<WSData>({ ...serveConfig, port: port + attempt });
      lastError = null;
      break;
    } catch (err: any) {
      lastError = err;
      if (err?.code !== "EADDRINUSE") throw err;
    }
  }
  if (lastError) throw lastError;

  return {
    get port() {
      return server.port;
    },
    broadcast,
    stop: () => server.stop(),
  };
}
