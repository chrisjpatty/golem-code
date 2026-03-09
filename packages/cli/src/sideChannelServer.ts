/**
 * Side-channel server: Bun WebSocket server that broadcasts GolemEvents
 * from the JSONL watcher to browser clients and receives inject commands.
 */

import type { ServerWebSocket } from "bun";
import { resolve, normalize } from "path";
import type { GolemEvent, GolemCommand } from "@golem-code/types";

type WSData = { id: string };

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

  const clients = new Set<ServerWebSocket<WSData>>();

  function broadcast(event: GolemEvent) {
    const json = JSON.stringify(event);
    for (const ws of clients) {
      ws.send(json);
    }
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
        clients.add(ws);
      },
      message(
        ws: ServerWebSocket<WSData>,
        raw: string | ArrayBuffer | Uint8Array,
      ) {
        if (typeof raw !== "string") return;

        try {
          const cmd = JSON.parse(raw) as GolemCommand;
          if (cmd.type === "inject" && onInject) {
            onInject(cmd.text);
          }
        } catch {
          // Invalid JSON — ignore
        }
      },
      close(ws: ServerWebSocket<WSData>) {
        clients.delete(ws);
      },
    },
  };

  let server: ReturnType<typeof Bun.serve<WSData>>;
  try {
    server = Bun.serve<WSData>({ ...serveConfig, port });
  } catch (err: any) {
    if (err?.code === "EADDRINUSE") {
      server = Bun.serve<WSData>({ ...serveConfig, port: 0 });
    } else {
      throw err;
    }
  }

  return {
    get port() {
      return server.port;
    },
    broadcast,
    stop: () => server.stop(),
  };
}
