import { useRef, useCallback } from "react";
import type { OutputEntry } from "../types";

/**
 * Manages rAF-throttled text and thinking streaming buffers.
 * Accumulates deltas and flushes them into OutputEntry state updates.
 */
export function useStreamingBuffers(
  setOutputEntries: React.Dispatch<React.SetStateAction<OutputEntry[]>>,
) {
  const textBufferRef = useRef("");
  const thinkingBufferRef = useRef("");
  const rafRef = useRef<number>(0);

  const flushTextBuffer = useCallback(() => {
    if (textBufferRef.current) {
      const text = textBufferRef.current;
      textBufferRef.current = "";
      setOutputEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.kind === "text" && last.streaming) {
          return [...prev.slice(0, -1), { kind: "text", text: last.text + text, streaming: false }];
        }
        return [...prev, { kind: "text", text, streaming: false }];
      });
    }
  }, [setOutputEntries]);

  const flushThinkingBuffer = useCallback(() => {
    if (thinkingBufferRef.current) {
      const text = thinkingBufferRef.current;
      thinkingBufferRef.current = "";
      setOutputEntries((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.kind === "thinking" && last.streaming) {
          return [...prev.slice(0, -1), { kind: "thinking", text: last.text + text, streaming: false }];
        }
        return [...prev, { kind: "thinking", text, streaming: false }];
      });
    }
  }, [setOutputEntries]);

  const scheduleStreamRender = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (textBufferRef.current) {
        const text = textBufferRef.current;
        setOutputEntries((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === "text" && last.streaming) {
            return [...prev.slice(0, -1), { kind: "text", text: last.text + text, streaming: true }];
          }
          return [...prev, { kind: "text", text, streaming: true }];
        });
        textBufferRef.current = "";
      }
      if (thinkingBufferRef.current) {
        const text = thinkingBufferRef.current;
        setOutputEntries((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.kind === "thinking" && last.streaming) {
            return [...prev.slice(0, -1), { kind: "thinking", text: last.text + text, streaming: true }];
          }
          return [...prev, { kind: "thinking", text, streaming: true }];
        });
        thinkingBufferRef.current = "";
      }
    });
  }, [setOutputEntries]);

  const appendTextDelta = useCallback((text: string) => {
    flushThinkingBuffer();
    textBufferRef.current += text;
    scheduleStreamRender();
  }, [flushThinkingBuffer, scheduleStreamRender]);

  const appendThinkingDelta = useCallback((text: string) => {
    flushTextBuffer();
    thinkingBufferRef.current += text;
    scheduleStreamRender();
  }, [flushTextBuffer, scheduleStreamRender]);

  const resetBuffers = useCallback(() => {
    textBufferRef.current = "";
    thinkingBufferRef.current = "";
  }, []);

  return {
    flushTextBuffer,
    flushThinkingBuffer,
    appendTextDelta,
    appendThinkingDelta,
    resetBuffers,
  };
}
