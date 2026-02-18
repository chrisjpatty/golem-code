import { useRef, useCallback } from "react";
import { HEADER_MIC_AUDIO } from "@golem-code/types";

const TARGET_SAMPLE_RATE = 16000;

type UseVoiceCaptureOptions = {
  getSocket: () => WebSocket | null;
};

export function useVoiceCapture({ getSocket }: UseVoiceCaptureOptions) {
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingRef = useRef(false);

  const startRecording = useCallback(async () => {
    const ws = getSocket();
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (recordingRef.current) return;

    recordingRef.current = true;

    // Open mic — request 16kHz but handle whatever we get
    const mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: TARGET_SAMPLE_RATE },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    streamRef.current = mediaStream;

    const ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    ctxRef.current = ctx;

    const actualRate = ctx.sampleRate;
    if (actualRate !== TARGET_SAMPLE_RATE) {
      console.warn(`[voice] Requested ${TARGET_SAMPLE_RATE}Hz, got ${actualRate}Hz`);
    }

    // Tell server to prepare STT with the actual sample rate
    ws.send(JSON.stringify({ type: "voice:start", sampleRate: actualRate }));

    await ctx.audioWorklet.addModule("/pcm-capture-processor.js");

    const source = ctx.createMediaStreamSource(mediaStream);
    sourceRef.current = source;

    const worklet = new AudioWorkletNode(ctx, "pcm-capture-processor");
    workletRef.current = worklet;

    worklet.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      const ws = getSocket();
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const pcmBuffer = e.data;
      // Prepend 0x01 header
      const frame = new ArrayBuffer(1 + pcmBuffer.byteLength);
      new Uint8Array(frame)[0] = HEADER_MIC_AUDIO;
      new Uint8Array(frame, 1).set(new Uint8Array(pcmBuffer));
      ws.send(frame);
    };

    source.connect(worklet);
    worklet.connect(ctx.destination); // needed for worklet to process, output is silent
  }, [getSocket]);

  const stopRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;

    const ws = getSocket();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "voice:stop" }));
    }

    // Tear down audio pipeline
    workletRef.current?.disconnect();
    workletRef.current = null;

    sourceRef.current?.disconnect();
    sourceRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    ctxRef.current?.close();
    ctxRef.current = null;
  }, [getSocket]);

  return { startRecording, stopRecording, isRecording: recordingRef };
}
