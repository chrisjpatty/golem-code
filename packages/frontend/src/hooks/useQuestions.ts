import { useCallback } from "react";
import type { GolemCommand, GolemQuestion } from "@golem-code/types";
import type { OutputEntry } from "../types";

export function useQuestions(
  sendCommandRef: React.RefObject<((cmd: GolemCommand) => void) | undefined>,
  setOutputEntries: React.Dispatch<React.SetStateAction<OutputEntry[]>>,
) {
  const handleQuestionAsk = useCallback(
    (event: { requestId: string; questions: GolemQuestion[] }) => {
      setOutputEntries((prev) => [
        ...prev,
        {
          kind: "question-ask",
          requestId: event.requestId,
          questions: event.questions,
          status: "pending" as const,
        },
      ]);
    },
    [setOutputEntries],
  );

  const handleQuestionRespond = useCallback(
    (requestId: string, answers: Record<string, string>) => {
      sendCommandRef.current?.({
        type: "question:answer",
        requestId,
        answers,
      });
      setOutputEntries((prev) =>
        prev.map((entry) =>
          entry.kind === "question-ask" && entry.requestId === requestId
            ? { ...entry, status: "answered" as const, selectedAnswers: answers }
            : entry,
        ),
      );
    },
    [sendCommandRef, setOutputEntries],
  );

  return {
    handleQuestionAsk,
    handleQuestionRespond,
  };
}
