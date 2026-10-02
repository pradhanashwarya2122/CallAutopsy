# CallAutopsy

**🔗 Live demo: [callautopsy.pages.dev](https://callautopsy.pages.dev/)**

A post-call failure analyzer for voice-AI pipelines. I built this because most voice-AI pipelines fail in ways that are genuinely painful to debug. Maybe the audio was fine but the STT got it wrong. Maybe the transcript was right but the LLM hallucinated. Maybe the response was correct but the TTS clipped it. Three separate systems, three separate failure modes, and no single tool that tells you which one just cost you money.

So I built one. It runs synthetic calls through a real STT → LLM → TTS pipeline, deliberately breaks them in seven different ways, and generates a human-readable postmortem for every failure, complete with the actual dollar cost, the classifier's guess, and the ground-truth label side by side. Every accuracy number I quote is measured against injected faults, not estimated.

The whole thing is styled like a clinical case file. Failed calls have a "cause of death." Reports read like autopsy notes. That's intentional, I wanted the UI to actually match what the tool does.

## What it does

- **Runs a real voice pipeline**: Deepgram (primary STT) → OpenAI `gpt-4o-mini` (LLM) → OpenAI `tts-1` (TTS), with automatic failover to OpenAI Whisper if Deepgram errors or times out.
- **Injects 7 kinds of failure on demand**: bad STT, hallucination, TTS glitch, timeout, user hangup, network drop, unhandled exception, each with its own tunable parameters (corruption density, adversarial prompt intensity, stage-to-trip, etc.).
- **Classifies what went wrong** using a mix of deterministic rules (SLA breach, error type), provider-reported signals (Deepgram word-level confidence, Whisper `avg_logprob`), and an LLM-based grounding check for hallucination.
- **Tracks real per-call cost** using published Deepgram and OpenAI rates, so this is the actual dollars a call would spend, not a guess.
- **Writes an LLM-generated postmortem** for every failed call, structured into Cause / Chain of events / Contributing factors / Recommendation.
- **Exports incident reports as PDF**, styled like an internal SRE postmortem.
- **Analyzes what every call means.** Alongside the pipeline, each call gets an analysis: who spoke (from the audio, not just from the recognizer), what the customer wants and which details they gave (checked against the transcript, attributed to the speaker who said them), how the call sounded (pace, pauses, pitch, audio quality), and a difficulty rating. Every claim carries its evidence or says it's uncertain. See "How the analysis works, and what it cannot do" below.

## The features I'm proud of

- **Provable failover.** A "Knock Deepgram offline" toggle on the dashboard force-errors every Deepgram call for 90 seconds. The next call visibly fails Deepgram, routes to Whisper, and succeeds, with the failover badge and cost delta shown live. This is the demo moment.
- **Chaos mode.** A per-workspace scheduler that fires random demo calls with random fault types into your own workspace (at most 12 a minute, stops after 15 minutes or at your daily limit). Each call is real and counts against your allowance.
- **Live stage timeline.** Each analysis shows STT → LLM → TTS (and the analysis step) with its real time, cost and status as it finishes.
- **Tunable fault injection.** Every fault type has its own parameter drawer, sliders for corruption density and timeout duration, chips for which stage to trip, temperature knobs for hallucination intensity. Plus 8 one-click presets ("Mild STT distortion", "Slow LLM 2s over SLA", "Hangup during LLM", etc.).
- **Calibration page with a full confusion matrix.** Precision/recall per fault type, computed against the injected ground-truth label. This is how I actually prove the classifier works.
- **Blast radius calculator.** Enter a hypothetical daily call volume and get a projected monthly cost per failure type, based on real observed rates. Includes a "what if we cut failures by N%" savings slider.
- **A/B pipeline comparison.** Run the same demo call through two configurations (Deepgram vs. Whisper, `gpt-4o-mini` vs. `gpt-4o`, or both), 1 to 5 times per side. A winner is named only for a real, consistent gap (see "A/B verdicts" below); otherwise it says there's no clear winner, or that the sides trade off.
- **Adversarial hallucination suite.** A fixed set of prompts designed to induce hallucination, replayed on demand, with a per-prompt hallucination rate aggregated across the last 10 runs.
- **Self-healing suggestion engine.** When one failure type recurs 3 or more times in 24 hours in your calls, an LLM reasons over the recent samples and proposes a concrete config change. Runs on demand.
- **Your own microphone.** Record up to 30 seconds in the browser. It gets converted to 16 kHz WAV so the full audio analysis (noise, bandwidth, speakers, pitch) works on it, and you get the same report as for the demo calls.
- **Autoplaying TTS reply.** As soon as a call completes, the CallDetail page auto-plays the synthesized voice reply.

## The stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express + TypeScript | Single runtime for orchestrator, queue worker, and WebSocket server |
| Queue | BullMQ on Redis | Retries with exponential backoff and a real DLQ |
| Database | PostgreSQL | Per-call structured records, every stage, cost, provider, classification lives as a row |
| STT primary | Deepgram `nova-3` | Free $200 credit, no card needed, per-second billing, word-level confidence scores |
| STT fallback | OpenAI `whisper-1` | Automatic if Deepgram errors or times out, which makes provider failover a real behavior, not a diagram |
| LLM | OpenAI `gpt-4o-mini` (with optional `gpt-4o` for A/B) | Cheap per-token, good enough for short assistant replies |
| TTS | OpenAI `tts-1` | Only TTS provider in scope (ElevenLabs excluded, its free tier is non-commercial and too thin) |
| Frontend | React + Vite + TypeScript + Tailwind | Fast build, no runtime component library, portable single-file components |
| Realtime | Native WebSocket (`ws`) | No managed pub/sub, no extra service |
| PDF export | `pdfkit` | Lightweight, no headless-browser overhead |
| Alerting | Discord webhook | Free, no app review |

Deliberately **not** using: Prometheus, Grafana, OpenTelemetry, Jaeger, Terraform, AWS, ElevenLabs, Azure. The observability story here is per-call structured records plus on-demand SQL, the right shape for "which specific call was misclassified" rather than "average latency last 5 minutes."

## Repo layout

```
call-autopsy/
├── backend/
│   ├── src/
│   │   ├── index.ts / server.ts   # entry (HTTP + WebSocket + worker) / express app
│   │   ├── analysis/              # call analysis: diarize.ts (who spoke, from pitch), turns.ts (turns, interruptions),
│   │   │                          # vocal.ts (delivery + tone), audioSignal.ts (noise, bandwidth, clipping), callUnderstanding.ts +
│   │   │                          # grounding.ts (intent, details, checked against the transcript), findings.ts, wer.ts
│   │   ├── auth/                  # workspace id (isolation) + admin token guard
│   │   ├── abTesting/             # runner + verdict.ts (when a winner may be named)
│   │   ├── admin/ chaos/ sla/     # per-workspace outage switch, chaos scheduler, SLA thresholds
│   │   ├── autopsy/ pdf/          # LLM postmortem, PDF report
│   │   ├── classifier/            # rules + STT confidence + TTS mismatch + grounding
│   │   ├── cost/ db/ queue/       # pricing, Postgres schema, BullMQ retry queue
│   │   ├── hallucinationSuite/ healing/
│   │   ├── pipeline/              # orchestrator, fault injection, llm, tts, stt/ (deepgram + whisper + router)
│   │   ├── redaction/             # PII redaction (text and nested objects)
│   │   ├── routes/ scripts/       # HTTP endpoints, maintenance scripts
│   │   └── storage/ websocket/
│   ├── samples/                   # 19 demo calls + manifest.json + truth/ (exact speaker timelines)
│   ├── test/                      # unit/ (no services), api/ (real Postgres + Redis), fixtures/ (real STT output), groundTruth.ts
│   └── bench/                     # benchmarks scored against ground truth (diarization, overlap, audio, background, analysis, live regression, faults)
├── frontend/
│   ├── src/                       # pages (Dashboard, Analyze, AB, Ops, CallDetail), components (CallAnalysis, ...), lib/api.ts
│   ├── test/                      # component tests on real analysis fixtures
│   └── e2e/                       # browser test against the real app (Playwright)
├── README.md
├── LICENSE
└── .gitignore
```

## Setup (my local walkthrough)

Prereqs: Node 20+, a running Postgres 14+, a running Redis 7+, plus an OpenAI API key and a Deepgram API key.

For Postgres and Redis locally I just use Docker:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16
docker run -d --name redis -p 6379:6379 redis:7
```

Then:

```bash
git clone <this repo>
cd call-autopsy

# backend
cd backend
npm install
cp .env.example .env
# edit .env, fill in DEEPGRAM_API_KEY, OPENAI_API_KEY, DATABASE_URL, REDIS_URL
psql "$DATABASE_URL" -f src/db/schema.sql
npm run healthcheck      # verifies Postgres + Redis reachable
# demo calls ship in backend/samples/*.wav (see "Demo audio" below), nothing to seed
npm run purge-synthetic  # only for a database that already holds old seeded/synthetic rows: dry run, add `-- --yes` to delete
npm run dev              # starts backend on :3000

# frontend, in another terminal
cd ../frontend
npm install
cp .env.example .env
npm run dev              # starts frontend on :5173
```

Then open http://localhost:5173. Or just try the hosted version: **[callautopsy.pages.dev](https://callautopsy.pages.dev/)**.

## Testing

Everything below runs from a clean checkout. Postgres and Redis are needed only for the API tests, and the two API keys only where marked.

| Command | What it proves | Needs |
| --- | --- | --- |
| `cd backend && npm test` | 121 unit tests: WER maths, number handling, redaction (every path, plus mutation-checked regressions), speaker separation on the 19 real demo calls and on synthetic scenes, interruption classification, vocal/tone rules, audio-quality detector against the 43 known recording conditions, grounding of extracted details, A/B verdict rules, Whisper parsing, TTS length cap, Ops isolation | nothing (fixtures hold real recognizer output) |
| `cd backend && npm run test:api` | 17 tests against the real Express app, Postgres and Redis: every state-changing route refuses a request with no workspace, workspaces cannot read each other's calls/audio/PDFs/A-B runs/events, per-workspace SLA/outage/chaos, operator endpoints need `ADMIN_TOKEN`, raw personal details in stored rows never leave the API or the PDF | Postgres, Redis |
| `cd frontend && npm test` | 14 component tests: the analysis UI rendered from real analysis objects (speaker labels, uncertainty, three tone readings, no invented values, old rows still render) | nothing |
| `cd frontend && npm run test:e2e` | one Chromium run through the real app: first visit is empty, all 19 calls listed, stress call, three injected faults (the slider value must reach the model), microphone recording, upload, isolation between two browsers, Analyze (incl. blast radius and hallucination suite), A/B, Ops (SLA, outage, chaos). Every call-related check reads the result back from the API and compares it with what the page shows | backend + frontend running, both API keys (a few cents) |
| `cd backend && npm run typecheck && npm run typecheck:tests` | types for `src`, tests and benchmarks | nothing |

**Running the live tests and benchmarks.** They send many analyses from one address, so start the backend with `MAX_ANALYSES_PER_IP_PER_HOUR=1000` (the default is 60 per network address per hour, which the live benchmarks and the browser test exceed within one hour; once the limit is hit, calls answer `429 ip_limit`, as designed). Each workspace is also limited to 25 analyses per 24 hours, so every script uses fresh workspaces.

Benchmarks (`backend/bench/`, results in `backend/bench/results/`, summarized in [`bench/results/MATRIX.md`](backend/bench/results/MATRIX.md)):

- `npm run bench:diarization`, `bench:overlap`, `bench:audio`, `bench:background`: offline, scored against `samples/truth/`, `test/groundTruth.ts`, `test/audioTruth.ts`.
- `npx tsx bench/analysis-benchmark.ts`: real Deepgram output (recorded) + the real model, 15 calls, scored per category (needs `OPENAI_API_KEY`).
- `npx tsx bench/regression-live.ts`: all 19 calls through the running backend and real providers, results read back from the API and scored with the same code.
- `npx tsx bench/fault-benchmark.ts`: 6 deterministic fault types + hallucination, each on 3 stress calls, diagnosis vs the injected fault.
- `npx tsx bench/build-matrix.ts` assembles the matrix from those result files.

What the measured results honestly say (details and every remaining failure are in `MATRIX.md`):

- Calibration is **in-sample**: pitch, noise and band-limit thresholds and the prompt were tuned on these 19 calls, and there are only four two-voice calls and 15 single-voice ones. Numbers on other audio will be lower; the tests guard against regressions, not against overfitting.
- The remaining failures are audio- or model-limited, not software defects: noisy calls at 16-19% word error, "twenty-two ninety-nine" transcribed as `2299`, "sixty two hours" for a price, hallucination injection that doesn't always make the model invent anything (and a slow model reply gets diagnosed as `timeout` before it can be diagnosed as a hallucination: 0 of 3 in the last run, 3 of 3 and 2 of 3 in earlier ones), and Deepgram's occasional timeouts in the test sandbox, which correctly appear as `timeout` with a Whisper fallback.
- Defects found only by running the real pipeline (not by the fixture tests) and fixed with regression tests: an order number said twice was redacted as a phone number, a runaway reply over the TTS length limit crashed the stage and was misdiagnosed, and after a Deepgram timeout the Whisper fallback returned no word timings, so speakers, pauses and hesitation were lost.
- Two independent code reviews of the whole change found further defects (a WAV header that could hang the corruption fault, an analysis step that could throw and strand a call, per-workspace limits that a script could bypass by minting workspace ids, calibration scoring unlabelled real uploads as "ok", limits charged before a request was validated, and others); each was fixed with a test that fails without the fix.

## Deploying

- **Backend on Railway**: single Node service, set every var from `backend/.env.example`. Add the Postgres and Redis addons; Railway injects `DATABASE_URL` and `REDIS_URL` automatically. Start command: `npm run build && npm start`. WebSocket path is `/ws`.
- **Frontend on Cloudflare Pages**: connect the repo, set build command `npm run build`, output `dist/`, and set `VITE_API_BASE_URL` + `VITE_WS_URL` to the deployed Railway URL (use `wss://` for the WebSocket). This is exactly how the live demo at [callautopsy.pages.dev](https://callautopsy.pages.dev/) is running.

## How I demo this in 60 seconds

1. Open the dashboard (it starts empty, on purpose). Pick **S9 · Frustrated female, four problems, street** in the Demo call dropdown and click **Analyze this call**. Stages fill in as they finish, then the analysis: intent, details the customer gave, a correction (order 4821 → 4917), three separate tone readings, and what was noticed about the audio.
2. Open the **Transcript** tab: two voices found from the audio, labelled, with the script underneath and the transcript's match to it.
3. Under **Simulate a failure** pick *Push the model to invent facts*, move the Temperature slider, analyze a quick clip. Then *Make a stage run too slowly*, then *Garble the audio*. Each is diagnosed and shows in Recent calls.
4. On **Ops**, click **Knock offline (90s)**, analyze a call: the row shows the Whisper fallback. (Only your own calls are affected.)
5. **Analyze → Calibration → Generate calibration data** runs one call clean and under every fault, then shows the confusion matrix measured against what was injected.
6. **A/B**: same call, Deepgram vs Whisper, 2 runs each. The verdict says which side is better and why, or that there's no clear winner.
7. Click **Record** and speak: same report for your own voice.

Try it yourself at **[callautopsy.pages.dev](https://callautopsy.pages.dev/)**, no signup needed.

## Demo audio: where it comes from and how to add your own

The Dashboard needs real audio to analyze. Three ways to get it:

1. **Bundled demo calls** (nothing to do). `backend/samples/` ships 19 calls in three groups: 5 core scenarios (clean baseline up to a failure-heavy multi-intent call), 10 stress tests (ten different speakers, delivery styles and recording environments: hesitation, interruptions, self-corrections, a telephone line, a café, a train), and 4 quick clips. Pick one from the **Demo call** dropdown; each shows the speaker, the recording conditions, what it's designed to stress and its script, and has a Play preview and an **Analyze this call** button. The exact speaker timeline of every multi-speaker call is in `backend/samples/truth/`, which is what the diarization and interruption benchmarks are scored against. See `backend/samples/README.md`.
2. **Drop in your own.** Drag any `.wav` / `.mp3` / `.m4a` / `.ogg` / `.webm` / `.flac` file (up to 5 MB) onto the Dashboard, or click **Record** and speak. Good sources of realistic test audio: your own voice memos, a real call recording you have the right to use, or public speech datasets such as LibriSpeech and Mozilla Common Voice.
3. **Generate more.** Edit `backend/samples/manifest.json` and run `npm run generate-demo-calls -- --engine openai --only <file>` (needs `OPENAI_API_KEY`, `ffmpeg` and `espeak-ng`; uses `gpt-4o-mini-tts`, a few cents per call). Without a key, omit `--engine` to render offline with `espeak-ng`. `--truth` rewrites the speaker timelines without rendering audio.

The Dashboard's **Simulate a failure** section deliberately breaks one analysis (garbled audio, invented facts, a cut-off reply, a slow stage, ...) so you can watch it get diagnosed. It's off by default and switches itself off after one use.

## How the analysis works, and what it cannot do

Every finished call gets an analysis (`calls.analysis`, stage `analysis` in the timeline, about $0.0004). Nothing in it is decorative: each item is measured, checked against the transcript, or marked uncertain.

| Question | How it is answered | What it cannot do |
| --- | --- | --- |
| **Who spoke?** | Speech recognizers often merge two voices on noisy or single-channel audio. The audio is measured directly: the pitch of each phrase is compared, and a second voice is reported only when the phrases fall into two clearly separated pitch groups (at least 5.5 semitones apart, each group tight, the quieter voice at least 1 s). Words are then assigned with a smoothing pass. If the recognizer claims two speakers but the audio shows one pitch, its labels are kept but marked uncertain. With no decodable audio (mp3/m4a uploads) only the recognizer's labels exist and they're flagged *not verified*. | Two voices with the **same pitch** can't be separated by pitch: the result is one voice (or the recognizer's uncertain labels). Thresholds were calibrated on this repo's 19 demo calls, so they're in-sample. |
| **Interruptions and overlap** | Every speaker change is classified as *simultaneous speech*, *interruption*, *backchannel* or *normal transition*, with confidence and the evidence used (overlapping word timestamps; a sentence that stops without an ending followed at once by the other speaker; a short acknowledgement while the other carries on). | On a single-channel recording the recognizer usually keeps only the louder of two simultaneous voices and its word timestamps touch at speaker changes, so most real overlap leaves no trace. Overlap counts are a **lower bound**, and the report says so. Measured on the scripted calls: 3 of 10 events found, 0 false alarms. |
| **What does the customer want, and what did they say?** | A language model (`gpt-4o-mini`, temperature 0, fixed seed) lists every problem raised, picks the main intent, and extracts details and self-corrections. Then **code** checks each value against the transcript (spoken numbers and ordinals included), drops anything not there, and attributes each detail to the speaker whose turn contains it: a value only the other voice said is shown as such, and when speakers are unverified it's shown as "who said it is unclear". A bare 4-digit amount ("It's 2299") is always flagged as possibly $22.99. Obvious "number, sorry, number" corrections the model misses are added from the wording. | The model can still miss a problem or misread a doubtful transcript; its output is one reading, not a fact. |
| **How did it sound?** | Measured from the audio per voice: words per minute while speaking, pauses, filler words, pitch movement, loudness spread. An activation level (animated / ordinary / subdued) is claimed only when several cues agree and the recording is clean enough; otherwise it says "no clear reading". | A voice can't show whether someone is pleased or upset, so no such claim is made from audio. Confidence is never above "medium". |
| **What emotion?** | Three separate readings: from the **words** (the model sees only text and may answer "not evident"), from the **voice** (above), and an **overall** label that says whether they agree, differ, or only one source exists. They're never averaged. | Delivery in the demo calls is synthetic text-to-speech told to sound a certain way, so "matches the styled delivery" is a consistency check, not proof about human emotion. |
| **Audio quality** | Signal-to-noise (20th-percentile noise floor), clipping, bandwidth (energy at 5-7 kHz vs 0.5-2.5 kHz in loud frames) and loudness spread, combined into *clean wideband / acceptable / noisy / band-limited / clipped / compressed / degraded*. | Compression can't be told from steady noise below 18 dB SNR, so it's not flagged there. A band limit hidden by codec noise (the train call) isn't detected. |
| **Speech from the environment** | Quiet phrases whose pitch matches no voice in the call are set aside as background; the model must quote off-topic fragments verbatim and code verifies the quote. | Equal-level background speech mixed with the caller can't be separated on one channel. In one manual experiment the recognizer ignored an announcement mixed in 12 dB below speech, leaked fragments at 6 dB, and garbled the call at equal level. |
| **Transcript accuracy** | For demo calls the known script gives word error rate two ways: *normalized* (spoken and written numbers are equal) and *strict* (they are not), plus how many numbers were heard exactly. Both are shown. | Real recognition errors are reported, never smoothed away: the noisy calls are at 16-19% (Deepgram heard "sixty two **hours**"), and "twenty-two ninety-nine" is transcribed as 2299. |

**Privacy.** Redaction (e-mail, card, SSN, phone, long spoken digit runs) is applied before text reaches the reply model, the hallucination check, the analysis model, the database (`redacted_transcript`, stage metadata, analysis, postmortem) and again on the way out of the API and into the PDF, so rows written before a rule existed are cleaned too. Tests prove that every one of those paths drops the raw values. Spoken personal details inside the stored *audio* are not removed.

**A/B verdicts.** Reply generation uses temperature 0 in A/B runs. A side wins a measure only when the gap is practically meaningful (half of the runs failing, 3 points of transcript error, or 10% in pipeline time or cost) and every run of the better side beats every run of the other. Quality outranks speed and cost; conflicting quality results are reported as a trade-off; fewer than 2 runs per side gives no verdict; a silent provider fallback is disclosed. Time is the pipeline's own stage time, not the wait for the parallel analysis.

## Your data is per-browser

There are no accounts. The first time you open the Dashboard your browser generates a random **workspace key** (a UUID kept in `localStorage`) and sends it with every request. Calls, audio, PDFs, live WebSocket events, A/B runs, calibration, blast radius, SLA thresholds, self-healing suggestions and the Ops controls (outage switch, chaos mode) are all scoped to it, so one visitor never sees or changes another's data. Click **My workspace** in the top bar to copy your key, open the same workspace on another device, or start fresh.

**Security model, stated plainly.**

- This is isolation, not authentication. The key is a bearer secret: whoever holds it *is* that workspace, so a user can only ever change the workspace whose key they hold, and there's no way to derive or guess another key (random UUIDv4). There's no login, no password reset and no recovery: clearing site data loses the key unless you saved it.
- It's enforced on the server, not in the UI: every read and write of workspace data checks the key, state-changing requests accept it **only in the `X-Workspace-Id` header** (never in the URL, so it doesn't reach access logs or shared links), and `GET` requests for audio, PDFs and the WebSocket accept `?ws=` because browsers can't set headers there. `backend/test/api/api.test.ts` walks every mutating route and proves each refuses a request without a workspace.
- Operator-only endpoints (`/queue/dlq`, `/budget`, `/sla/test-webhook`) need the deployment's `ADMIN_TOKEN` in an `X-Admin-Token` header and are switched off when no token is set. Nothing in the UI uses them.
- `/queue/stats` is a server-wide set of counters (no call data) and is labelled that way in the UI.
- Not covered, and not pretended: a leaked key is a leaked workspace; there's no rate limiting per IP beyond one analysis per 10 seconds and 25 per 24 hours per workspace; uploaded audio is stored as sent (spoken personal details in the audio itself are not removed, only in text).

Each workspace is limited to 25 analyses per rolling 24 hours (`MAX_CALLS_PER_WORKSPACE_PER_DAY`) and 5 MB per upload (`MAX_UPLOAD_BYTES`).

## What's deliberately out of scope

- Multi-turn conversation. Every call is single-turn, voice in, voice out. Adding conversation history would double the surface area without changing what the tool is actually about.
- Real authentication. Everything is isolated per browser workspace (see "Your data is per-browser" above), and the operator endpoints need `ADMIN_TOKEN`, but there are no user accounts. For a real launch I'd add accounts (or Cloudflare Access).
- Metrics scraping. The observability story here is per-call rows in Postgres plus on-demand SQL, not a Prometheus histogram. Different tool for a different job.

## What I'd add next

- **Streaming transcription** so the transcript appears word-by-word instead of after the whole clip uploads.
- **Incident grouping**: merge N failed calls of the same type in the same window into one "incident" with a count.
- **Apply-suggestion loop**: take a self-healing suggestion, apply it as a config change, re-run A/B to prove it helped.

## License

MIT. See [LICENSE](LICENSE).
