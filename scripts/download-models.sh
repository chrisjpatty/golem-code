#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="$(cd "$(dirname "$0")/.." && pwd)/models"
mkdir -p "$MODELS_DIR"

# ── STT: Streaming zipformer (English, small 20M param, ~30MB) ──

STT_DIR="$MODELS_DIR/stt"
if [ -f "$STT_DIR/tokens.txt" ]; then
  echo "✓ STT model already downloaded"
else
  echo "Downloading STT model (streaming zipformer en-20M)..."
  mkdir -p "$STT_DIR"
  STT_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17.tar.bz2"
  TMP="$MODELS_DIR/stt-model.tar.bz2"
  curl -L -o "$TMP" "$STT_URL"
  tar -xjf "$TMP" -C "$STT_DIR" --strip-components=1
  rm "$TMP"
  echo "✓ STT model downloaded to $STT_DIR"
fi

# ── TTS: Piper VITS voice (en_US-amy-low, ~15MB) ──

TTS_DIR="$MODELS_DIR/tts"
if [ -f "$TTS_DIR/en_US-amy-low.onnx" ]; then
  echo "✓ TTS model already downloaded"
else
  echo "Downloading TTS model (Piper en_US-amy-low)..."
  mkdir -p "$TTS_DIR"
  TTS_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-amy-low.tar.bz2"
  TMP="$MODELS_DIR/tts-model.tar.bz2"
  curl -L -o "$TMP" "$TTS_URL"
  tar -xjf "$TMP" -C "$TTS_DIR" --strip-components=1
  rm "$TMP"
  echo "✓ TTS model downloaded to $TTS_DIR"
fi

echo ""
echo "All models ready in $MODELS_DIR"
echo "  STT: $STT_DIR"
echo "  TTS: $TTS_DIR"
