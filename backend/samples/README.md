# Bundled demo calls

These `.wav` files ship with the repo so a fresh deploy has audio to analyze. They are
synthetic speech (offline TTS), 16 kHz mono, 3-6 seconds each:

| File | Says |
|---|---|
| `refund-request.wav` | "Hi, I was charged twice on my last invoice and I would like a refund please." |
| `book-table.wav` | "Book me a table for two at seven pm tonight." |
| `weather-today.wav` | "What's the weather going to be like today?" |
| `noisy-line.wav` | "Uh, hi, I need to check my, uh, account balance." (fast voice + static) |

Regenerate or extend them with `npm run generate-samples` (needs `espeak-ng` and `ffmpeg`;
edit `scripts/generate-samples.sh` to add a line). Or skip all of this and drop your own
`.wav`/`.mp3`/`.m4a` recording (max 5 MB) into the dashboard's upload box.

`npm run seed-samples` is an alternative that generates natural-sounding `.mp3` clips with
OpenAI TTS (needs `OPENAI_API_KEY`); those are git-ignored.

Any file here can be analyzed via `POST /calls` with `sampleId=<file name>`.
