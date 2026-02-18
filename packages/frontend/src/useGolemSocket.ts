import { useRef, useEffect, useCallback, useState } from "react";
import type { GolemEvent, GolemCommand } from "@golem-code/types";
import { HEADER_TTS_AUDIO } from "@golem-code/types";

function getDefaultWsUrl(): string {
  // Allow explicit override via env var
  const envUrl = (import.meta as any).env?.VITE_GOLEM_WS_URL;
  if (envUrl) return envUrl;

  // When served from the agent server, derive WS URL from the page origin
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
  onAudioChunk?: (float32: Float32Array) => void;
};

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 16000;

export function useGolemSocket({
  url = DEFAULT_WS_URL,
  onEvent,
  onAudioChunk,
}: UseGolemSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const onAudioChunkRef = useRef(onAudioChunk);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");

  // Keep refs in sync without triggering reconnects
  onEventRef.current = onEvent;
  onAudioChunkRef.current = onAudioChunk;

  useEffect(() => {
    let disposed = false;
    let reconnectDelay = RECONNECT_BASE_MS;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (disposed) return;
      setConnectionState("connecting");

      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed) { ws.close(); return; }
        console.log("[golem-ws] Connected");
        setConnectionState("connected");
        reconnectDelay = RECONNECT_BASE_MS;
      };

      ws.onmessage = (e: MessageEvent) => {
        if (e.data instanceof ArrayBuffer) {
          const view = new Uint8Array(e.data);
          if (view.length < 2) return;

          if (view[0] === HEADER_TTS_AUDIO) {
            const audioBytes = e.data.slice(1);
            const float32 = new Float32Array(audioBytes);
            onAudioChunkRef.current?.(float32);
          }
          return;
        }

        // String message — JSON GolemEvent
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

  const getSocket = useCallback(() => wsRef.current, []);

  return { sendCommand, getSocket, connectionState };
}
