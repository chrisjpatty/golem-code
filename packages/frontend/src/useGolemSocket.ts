import { useRef, useEffect, useCallback } from "react";
import type { GolemEvent, GolemCommand } from "@golem-code/types";

const HEADER_TTS_AUDIO = 0x02;

type UseGolemSocketOptions = {
  url?: string;
  onEvent?: (event: GolemEvent) => void;
  onAudioChunk?: (float32: Float32Array) => void;
};

export function useGolemSocket({
  url = "ws://localhost:4747/ws",
  onEvent,
  onAudioChunk,
}: UseGolemSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const onAudioChunkRef = useRef(onAudioChunk);

  // Keep refs in sync without triggering reconnects
  onEventRef.current = onEvent;
  onAudioChunkRef.current = onAudioChunk;

  useEffect(() => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      console.log("[golem-ws] Connected");
    };

    ws.onmessage = (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) {
        const view = new Uint8Array(e.data);
        if (view.length < 2) return;

        if (view[0] === HEADER_TTS_AUDIO) {
          // Extract Float32 audio after the 1-byte header
          // Need to handle potential alignment issues
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
      console.log("[golem-ws] Disconnected");
      wsRef.current = null;
    };

    ws.onerror = (err) => {
      console.error("[golem-ws] Error:", err);
    };

    return () => {
      ws.close();
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

  return { sendCommand, getSocket };
}
