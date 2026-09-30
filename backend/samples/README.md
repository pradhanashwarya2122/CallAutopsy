# Bundled demo calls

`manifest.json` is the single source of truth: for each call it holds the script (what the customer says),
the voice and noise recipe used to render it, and the caption the Dashboard shows. The backend serves it from
`GET /samples`; `scripts/generate-demo-calls.mjs` renders it into the `.wav` files here.

## The five interview calls (all 16 kHz mono 16-bit WAV)

| # | File | Length | Designed to stress |
|---|---|---|---|
| 1 | `call-1-clean-baseline.wav` | ~15 s | Healthy baseline: clear speech, one intent, no noise |
| 2 | `call-2-noisy-cafe.wav` | ~11 s | Environmental noise: cafe chatter, traffic, clatter, uneven volume (about 10 dB above the noise) |
| 3 | `call-3-mumbled-unsure.wav` | ~18 s | Speaking style: fillers, restarts, pauses, a self-corrected amount, quiet delivery |
| 4 | `call-4-long-multi-detail.wav` | ~32 s | Context over time: retry, double charge, corrected amount and order number, prior support contact |
| 5 | `call-5-failure-heavy-multi-intent.wav` | ~21 s | Six related intents, a failed-vs-pending contradiction, an unknown fee |

"Designed to stress" describes intent only. The diagnosis always comes from the real pipeline. Everything in the scripts
is fictional (order numbers, amounts, situations). Four older quick clips (`refund-request`, `book-table`,
`weather-today`, `noisy-line`) are kept in the "Quick clips" group of the dropdown.

## Regenerating

```bash
# OpenAI tts-1 (the cheapest TTS model; ~1,500 characters, about 2 cents for all five). Needs OPENAI_API_KEY + ffmpeg.
npm run generate-demo-calls -- --engine openai

# Offline (robotic voices). Needs espeak-ng + ffmpeg.
npm run generate-demo-calls

# One call only
npm run generate-demo-calls -- --engine openai --only call-2-noisy-cafe.wav
```

Edit `manifest.json` (script text, `voice`, `post` preset: `clean` | `phone` | `mumble` | `cafe`) and re-run to change a call.
`npm run generate-samples` (espeak) and `npm run seed-samples` (OpenAI mp3) are the older generators for the quick clips.
