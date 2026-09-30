#!/usr/bin/env bash
# Generates the demo call recordings in backend/samples/ using offline TTS.
# Needs: espeak-ng, ffmpeg.   Usage: ./scripts/generate-samples.sh
# Add your own line to CALLS to create more; or just drop real .wav/.mp3/.m4a
# files into the dashboard's upload box instead.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p samples
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

say() { # say <out.wav> <voice> <wpm> <text>
  espeak-ng -v "$2" -s "$3" -w "$tmp/raw.wav" "$4"
  ffmpeg -y -loglevel error -i "$tmp/raw.wav" -ar 16000 -ac 1 -sample_fmt s16 "$1"
}

say samples/refund-request.wav   en-us+f3 150 "Hi, I was charged twice on my last invoice and I would like a refund please."
say samples/book-table.wav       en-us+m3 155 "Book me a table for two at seven pm tonight."
say samples/weather-today.wav    en-us+f2 150 "What's the weather going to be like today?"

# Noisy line: fast, low-quality voice mixed with white noise.
espeak-ng -v en-us+m7 -s 190 -w "$tmp/raw.wav" "Uh, hi, I need to check my, uh, account balance."
ffmpeg -y -loglevel error -i "$tmp/raw.wav" -f lavfi -i "anoisesrc=color=white:amplitude=0.15:d=10" \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=first:weights=1 0.8" -ar 16000 -ac 1 -sample_fmt s16 samples/noisy-line.wav

ls -la samples/*.wav
