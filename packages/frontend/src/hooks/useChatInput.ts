import { useState, useCallback, useRef } from "react";
import type { GolemCommand } from "@golem-code/types";
import type { OutputEntry } from "../types";

export function useChatInput(
  sendCommandRef: React.RefObject<((cmd: GolemCommand) => void) | undefined>,
  setOutputEntries: React.Dispatch<React.SetStateAction<OutputEntry[]>>,
) {
  const [inputText, setInputText] = useState("");
  const [queryActive, setQueryActive] = useState(false);
  const queueRef = useRef<string[]>([]);

  const sendMessage = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");

    if (!queryActive) {
      // Idle: send immediately
      setOutputEntries((prev) => [...prev, { kind: "user-message", text }]);
      sendCommandRef.current?.({ type: "query:start", prompt: text });
      setQueryActive(true);
    } else {
      // Busy: queue the message
      queueRef.current.push(text);
      setOutputEntries((prev) => [
        ...prev,
        { kind: "queued-message", text, status: "queued" as const },
      ]);
    }
  }, [inputText, queryActive, sendCommandRef, setOutputEntries]);

  const stopQuery = useCallback(() => {
    sendCommandRef.current?.({ type: "query:stop" });
    // Cancel all queued messages
    queueRef.current = [];
    setOutputEntries((prev) =>
      prev.map((entry) =>
        entry.kind === "queued-message" && entry.status === "queued"
          ? { ...entry, status: "cancelled" as const }
          : entry,
      ),
    );
    setQueryActive(false);
  }, [sendCommandRef, setOutputEntries]);

  const handleQueryStart = useCallback(() => {
    setQueryActive(true);
  }, []);

  const handleQueryEnd = useCallback(() => {
    const queued = queueRef.current;
    if (queued.length > 0) {
      const combinedText = queued.join("\n\n");
      queueRef.current = [];
      // Mark all queued entries as sending
      setOutputEntries((prev) =>
        prev.map((entry) =>
          entry.kind === "queued-message" && entry.status === "queued"
            ? { ...entry, status: "sending" as const }
            : entry,
        ),
      );
      sendCommandRef.current?.({ type: "query:start", prompt: combinedText });
      // queryActive stays true since we just started a new query
    } else {
      setQueryActive(false);
    }
  }, [sendCommandRef, setOutputEntries]);

  const clearAll = useCallback(() => {
    queueRef.current = [];
    setQueryActive(false);
    setInputText("");
  }, []);

  return {
    inputText,
    setInputText,
    queryActive,
    sendMessage,
    stopQuery,
    handleQueryStart,
    handleQueryEnd,
    clearAll,
  };
}
