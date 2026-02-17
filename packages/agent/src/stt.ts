import { resolve } from "path";
import { initWhisper, type WhisperContext } from "@fugood/whisper.node";

const MODELS_ROOT = resolve(import.meta.dir, "../../../models");
const MODEL_PATH = resolve(MODELS_ROOT, "stt/ggml-large-v3-turbo.bin");

let ctx: WhisperContext | null = null;

// Eagerly load model at startup
const loadStart = performance.now();
console.log("[stt] Loading whisper model...");
initWhisper({ filePath: MODEL_PATH, useGpu: true }).then((c) => {
  ctx = c;
  console.log(`[stt] Whisper model loaded in ${(performance.now() - loadStart).toFixed(0)}ms`);
});

// Session state: buffer audio chunks during push-to-talk
let audioChunks: Int16Array[] = [];
let clientSampleRate = 16000;
let totalSamples = 0;

export function startSession(sampleRate: number): void {
  audioChunks = [];
  clientSampleRate = sampleRate;
  totalSamples = 0;
  console.log(`[stt] Session started (sampleRate=${sampleRate})`);
}

export type SttResult = { text: string; isFinal: boolean } | null;

export function feedAudio(int16: Int16Array): SttResult {
  audioChunks.push(int16);
  totalSamples += int16.length;
  // Batch mode — no partial results
  return null;
}

export async function endSession(): Promise<string> {
  if (audioChunks.length === 0) return "";
  if (!ctx) {
    console.warn("[stt] Model not loaded yet, skipping transcription");
    audioChunks = [];
    return "";
  }

  const durationSec = (totalSamples / clientSampleRate).toFixed(1);
  console.log(`[stt] Transcribing ${totalSamples} samples (~${durationSec}s)`);

  // Concatenate all chunks into a single Int16 buffer
  const fullBuffer = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of audioChunks) {
    fullBuffer.set(chunk, offset);
    offset += chunk.length;
  }
  audioChunks = [];

  // @fugood/whisper.node accepts 16-bit PCM as ArrayBuffer directly
  const t0 = performance.now();
  const { promise } = ctx.transcribeData(fullBuffer.buffer, { language: "en" });
  const result = await promise;
  const elapsed = performance.now() - t0;
  const text = result.result.trim();
  const rtf = elapsed / (parseFloat(durationSec) * 1000);
  console.log(`[stt] Transcript (${elapsed.toFixed(0)}ms, ${rtf.toFixed(2)}x RT): "${text}"`);
  return text;
}
