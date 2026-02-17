import { useRef, useCallback } from "react";

type UseAudioPlaybackOptions = {
  onPlaybackComplete?: () => void;
};

export function useAudioPlayback({ onPlaybackComplete }: UseAudioPlaybackOptions = {}) {
  const ctxRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const playingSRef = useRef(false);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPlaybackCompleteRef = useRef(onPlaybackComplete);
  onPlaybackCompleteRef.current = onPlaybackComplete;

  const onTtsStart = useCallback((sampleRate: number) => {
    // Clear any pending end timer from a previous utterance
    if (endTimerRef.current) {
      clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
    // Create or reuse an AudioContext at the correct sample rate
    if (ctxRef.current) {
      ctxRef.current.close();
    }
    ctxRef.current = new AudioContext({ sampleRate });
    nextStartTimeRef.current = 0;
    playingSRef.current = true;
  }, []);

  const feedAudioChunk = useCallback((float32: Float32Array) => {
    const ctx = ctxRef.current;
    if (!ctx || !playingSRef.current) return;

    const buffer = ctx.createBuffer(1, float32.length, ctx.sampleRate);
    buffer.copyToChannel(new Float32Array(float32), 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // Schedule seamlessly after the previous chunk
    const now = ctx.currentTime;
    if (nextStartTimeRef.current < now) {
      nextStartTimeRef.current = now;
    }
    source.start(nextStartTimeRef.current);
    nextStartTimeRef.current += buffer.duration;
  }, []);

  const onTtsEnd = useCallback(() => {
    playingSRef.current = false;
    // Schedule the playback-complete callback for when audio actually finishes
    const ctx = ctxRef.current;
    if (ctx && onPlaybackCompleteRef.current) {
      const remaining = Math.max(0, nextStartTimeRef.current - ctx.currentTime);
      endTimerRef.current = setTimeout(() => {
        endTimerRef.current = null;
        onPlaybackCompleteRef.current?.();
      }, remaining * 1000);
    }
  }, []);

  return { onTtsStart, feedAudioChunk, onTtsEnd };
}
