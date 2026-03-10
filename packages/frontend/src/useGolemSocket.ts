import { useRef, useEffect, useCallback, useState } from "react";
import type { GolemEvent, GolemCommand } from "@golem-code/types";

function getDefaultWsUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_GOLEM_WS_URL;
  if (envUrl) return envUrl;

  if (typeof window !== "undefined" && window.location) {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/ws`;
  }

  return "ws://localhost:4747/ws";
}

const DEFAULT_WS_URL = getDefaultWsUrl();

export type ConnectionState = "connecting" | "connected" | "disconnected";

type UseGolemSocketOptions = {
  url?: string;
  onEvent?: (event: GolemEvent) => void;
};

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 16000;

export function useGolemSocket({
  url = DEFAULT_WS_URL,
  onEvent,
}: UseGolemSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");

  onEventRef.current = onEvent;

  useEffect(() => {
    let disposed = false;
    let reconnectDelay = RECONNECT_BASE_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (disposed) return;
      setConnectionState("connecting");

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) { ws.close(); return; }
        console.log("[golem-ws] Connected");
        setConnectionState("connected");
        reconnectDelay = RECONNECT_BASE_MS;
      };

      ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data !== "string") return;

        try {
          const event = JSON.parse(e.data) as GolemEvent;
          onEventRef.current?.(event);
        } catch {
          console.warn("[golem-ws] Invalid event:", e.data);
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (disposed) return;
        setConnectionState("disconnected");
        console.log(`[golem-ws] Disconnected, reconnecting in ${reconnectDelay}ms`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
          connect();
        }, reconnectDelay);
      };

      ws.onerror = (err) => {
        console.error("[golem-ws] Error:", err);
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [url]);

  const sendCommand = useCallback((cmd: GolemCommand) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(cmd));
    }
  }, []);

  return { sendCommand, connectionState };
}
