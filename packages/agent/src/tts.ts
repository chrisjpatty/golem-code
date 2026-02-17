import { resolve } from "path";

const sherpa_onnx = require("sherpa-onnx-node");

const MODELS_ROOT = resolve(import.meta.dir, "../../../models");
const TTS_DIR = resolve(MODELS_ROOT, "tts");

type OfflineTts = any;

let tts: OfflineTts | null = null;

function getTts(): OfflineTts {
  if (tts) return tts;

  tts = new sherpa_onnx.OfflineTts({
    model: {
      vits: {
        model: resolve(TTS_DIR, "en_US-reza_ibrahim-medium.onnx"),
        tokens: resolve(TTS_DIR, "tokens.txt"),
        dataDir: resolve(TTS_DIR, "espeak-ng-data"),
      },
      debug: false,
      numThreads: 1,
      provider: "cpu",
    },
    maxNumSentences: 2,
  });

  console.log(`[tts] OfflineTts initialized (sampleRate=${tts.sampleRate})`);
  return tts;
}

export type TtsResult = {
  samples: Float32Array;
  sampleRate: number;
};

/**
 * Synthesize text to audio using Piper VITS.
 */
export function synthesize(text: string): TtsResult {
  const engine = getTts();
  const audio = engine.generate({ text, sid: 0, speed: 1.0 });
  console.log(`[tts] Synthesized ${audio.samples.length} samples for: "${text.slice(0, 60)}..."`);
  return { samples: audio.samples, sampleRate: audio.sampleRate };
}

/**
 * Get the TTS output sample rate (e.g. 16000 or 22050).
 */
export function getSampleRate(): number {
  return getTts().sampleRate;
}
