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

## Stress-test calls (S1–S10)

Ten extra calls (`group: "stress"` in `manifest.json`) vary speaker, pace, emotion and recording conditions:
clean baseline, hesitant, home TV noise, fast with interruptions, telephone static, busy café, confused with
corrections, nervous with long pauses, frustrated multi-issue in the street, and a train + compressed phone line.
Each has `speaker`, `environment`, `tags`, `challenge` and the exact `script`.

Regenerate with `node scripts/generate-demo-calls.mjs` (needs `OPENAI_API_KEY`, uses `gpt-4o-mini-tts`, mixes noise with ffmpeg;
`--force` also rebuilds the frozen core calls). Every finished call also gets an automatic analysis (intent, entities,
corrections, tone, difficulty, measured audio quality) stored in `calls.analysis`.

Old synthetic rows in an existing database: `npm run purge-synthetic` (dry run) then `-- --yes`.
Operator-only: set `ADMIN_TOKEN` to enable the SLA webhook test.

## Ground truth and test fixtures

- `samples/truth/<call>.json`: the exact speaker timeline (who, text, start, end) of every multi-speaker stress call, produced by
  `node scripts/generate-demo-calls.mjs --engine openai --truth`, which lays the calls out from the cached speech clips (no audio is
  rendered and nothing is sent to the TTS API). Overlaps are real: a line that starts before the previous one ends overlaps it. The
  diarization, interruption and background-speech benchmarks are scored against these files. Single-speaker calls have one voice.
- `test/fixtures/stt/<call>.json`: the real Deepgram output for each call (words, timings, confidence, speaker labels), captured by
  `bench/capture-stt.mjs`. `test/fixtures/whisper/`: real Whisper responses for four calls (`bench/capture-whisper.ts`).
  Tests and offline benchmarks run on these, so they need no network.
- `test/groundTruth.ts`: what is actually in each call (intent, the numbers the customer said, self-corrections, ambiguity, the
  delivery each voice was told to use). `test/audioTruth.ts`: the recording conditions each call was rendered with.
- Recording conditions and per-voice pitch are described in `manifest.json` (`voice`, `agent`, `post`).
