# CallAutopsy

A post-call failure analyzer for voice-AI pipelines. I built this because most voice-AI pipelines fail in ways that are painful to debug — the audio was fine but the STT was wrong, the transcript was right but the LLM hallucinated, the response was correct but the TTS clipped. Three separate systems, three separate failure modes, and no single tool that tells you which one just cost you money.

So I built one. It runs synthetic calls through a real STT → LLM → TTS pipeline, deliberately breaks them in seven different ways, and generates a human-readable postmortem for every failure — with the actual dollar cost, the classifier's guess, and the ground-truth label side by side. Every accuracy number I quote is measured against injected faults, not estimated.

The whole thing is styled like a clinical case file. Failed calls have a "cause of death." Reports read like autopsy notes. That's on purpose — I wanted the UI to match what the tool actually does.

## What it does

- **Runs a real voice pipeline** — Deepgram (primary STT) → OpenAI `gpt-4o-mini` (LLM) → OpenAI `tts-1` (TTS), with automatic failover to OpenAI Whisper if Deepgram errors or times out.
- **Injects 7 kinds of failure on demand**: bad STT, hallucination, TTS glitch, timeout, user hangup, network drop, unhandled exception — each with its own tunable parameters (corruption density, adversarial prompt intensity, stage-to-trip, etc.).
- **Classifies what went wrong** using a mix of deterministic rules (SLA breach, error type), provider-reported signals (Deepgram word-level confidence, Whisper `avg_logprob`), and an LLM-based grounding check for hallucination.
- **Tracks real per-call cost** using published Deepgram and OpenAI rates — this is the actual dollars a call would spend, not a guess.
- **Writes an LLM-generated postmortem** for every failed call, structured into Cause / Chain of events / Contributing factors / Recommendation.
- **Exports incident reports as PDF** styled like an internal SRE postmortem.

## The features I'm proud of

- **Provable failover.** A "Knock Deepgram offline" toggle on the dashboard force-errors every Deepgram call for 90 seconds. The next call visibly fails Deepgram → routes to Whisper → succeeds, with the failover badge and cost delta shown live. This is the demo moment.
- **Chaos mode.** A configurable scheduler that continuously fires random calls with random fault types at whatever rate I set. Turn it on and the dashboard is always alive — great for demos where I want the page to move while I talk.
- **Live pipeline diagram.** A real-time SVG at the top of the dashboard showing STT → LLM → TTS. Cards light up amber (in-flight), green (ok), or red (error) as each stage fires. Arrows animate when data flows between them.
- **Tunable fault injection.** Every fault type has its own parameter drawer — sliders for corruption density and timeout duration, chips for which stage to trip, temperature knobs for hallucination intensity. Plus 8 one-click presets ("Mild STT distortion", "Slow LLM 2s over SLA", "Hangup during LLM", etc.).
- **Calibration page with a full confusion matrix.** Precision / recall per fault type, computed against the injected ground-truth label. This is how I prove the classifier actually works.
- **Blast radius calculator.** Enter a hypothetical daily call volume, get a projected monthly cost per failure type based on the real observed rates. Includes a "what if we cut failures by N%" savings slider.
- **A/B pipeline comparison.** Run the same fault through two configs (Deepgram vs. Whisper, `gpt-4o-mini` vs. `gpt-4o`, etc.). Get a side-by-side card with a WINNER badge and cost/failure-rate deltas.
- **Adversarial hallucination suite.** A fixed set of prompts designed to induce hallucination, replayed on demand, with a per-prompt hallucination rate aggregated across the last 10 runs.
- **Self-healing suggestion engine.** When a fault type recurs 5+ times in 24 hours, an LLM reasons over the recent samples and proposes a concrete config change. Runs on a 15-minute interval or on demand.
- **Live-mic mode with real audio distortion.** Record my voice in the browser — a canvas oscilloscope draws the waveform while I speak. When `bad_stt` is selected, the browser applies a real WaveShaper + white-noise mix before sending the audio, so the fault is *live*, not simulated on the server.
- **Autoplaying TTS reply.** As soon as a call completes, the CallDetail page auto-plays the synthesized voice reply.

## The stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express + TypeScript | Single runtime for orchestrator, queue worker, and WebSocket server |
| Queue | BullMQ on Redis | Retries with exponential backoff and a real DLQ |
| Database | PostgreSQL | Per-call structured records — every stage, cost, provider, classification lives as a row |
| STT primary | Deepgram `nova-3` | Free $200 credit, no card needed, per-second billing, word-level confidence scores |
| STT fallback | OpenAI `whisper-1` | Automatic if Deepgram errors or times out — makes provider failover a real behavior, not a diagram |
| LLM | OpenAI `gpt-4o-mini` (with optional `gpt-4o` for A/B) | Cheap per-token, good enough for short assistant replies |
| TTS | OpenAI `tts-1` | Only TTS provider in scope (ElevenLabs excluded — its free tier is non-commercial and too thin) |
| Frontend | React + Vite + TypeScript + Tailwind | Fast build, no runtime component library, portable single-file components |
| Realtime | Native WebSocket (`ws`) | No managed pub/sub, no extra service |
| PDF export | `pdfkit` | Lightweight, no headless-browser overhead |
| Alerting | Discord webhook | Free, no app review |

Deliberately **not** using: Prometheus, Grafana, OpenTelemetry, Jaeger, Terraform, AWS, ElevenLabs, Azure. The observability story here is per-call structured records + on-demand SQL — the right shape for "which specific call was misclassified" rather than "average latency last 5 minutes."

## Repo layout

```
call-autopsy/
├── backend/
│   ├── src/
│   │   ├── index.ts               # entry — HTTP + WebSocket + worker + monitors
│   │   ├── server.ts              # express app + route registration
│   │   ├── admin/                 # timed Deepgram-outage flag
│   │   ├── autopsy/               # LLM-generated postmortem
│   │   ├── abTesting/             # config-A vs config-B runner
│   │   ├── chaos/                 # continuous background call generator
│   │   ├── classifier/            # rules + STT confidence + TTS mismatch + grounding
│   │   ├── cost/                  # real Deepgram + OpenAI pricing + per-stage math
│   │   ├── db/                    # pg pool + schema.sql
│   │   ├── hallucinationSuite/    # adversarial prompts + runner
│   │   ├── healing/               # LLM-based self-healing suggestions
│   │   ├── pdf/                   # incident-report exporter
│   │   ├── pipeline/
│   │   │   ├── orchestrator.ts    # STT → LLM → TTS + fault application
│   │   │   ├── faultInjection.ts  # all 7 fault types + tunable params
│   │   │   ├── llm.ts / tts.ts
│   │   │   └── stt/               # deepgram + whisper + provider router
│   │   ├── queue/                 # BullMQ retry queue + DLQ
│   │   ├── redaction/             # regex email/phone/card/ssn scrub
│   │   ├── routes/                # all HTTP endpoints
│   │   ├── scripts/               # healthcheck, seed-samples, seed-demo-data
│   │   ├── sla/                   # threshold monitor + Discord webhook
│   │   ├── storage/               # per-call audio blobs on disk
│   │   └── websocket/             # broadcasts call lifecycle events
│   ├── samples/                   # bundled demo audio (generated by seed-samples)
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx                # router + nav shell
│   │   ├── main.tsx
│   │   ├── pages/                 # Dashboard, CallDetail, Replay, Calibration,
│   │   │                          # BlastRadius, ABComparison, HallucinationSuite,
│   │   │                          # Healing, SLASettings
│   │   ├── components/            # PipelineDiagram, OutageToggle, ChaosPanel,
│   │   │                          # FaultInjectionPanel, LiveMicRecorder,
│   │   │                          # SampleDropPanel, StageTimeline, Icons, etc.
│   │   ├── hooks/                 # WebSocket + auto-reconnect
│   │   ├── lib/                   # typed client for every backend endpoint
│   │   └── styles/
│   ├── public/favicon.svg
│   ├── package.json
│   └── .env.example
├── README.md
├── LICENSE
└── .gitignore
```

## Setup (my local walkthrough)

Prereqs: Node 20+, a running Postgres 14+, a running Redis 7+, plus an OpenAI API key and a Deepgram API key.

For Postgres + Redis locally I just use Docker:

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
# edit .env — fill in DEEPGRAM_API_KEY, OPENAI_API_KEY, DATABASE_URL, REDIS_URL
psql "$DATABASE_URL" -f src/db/schema.sql
npm run healthcheck      # verifies Postgres + Redis reachable
# demo calls ship in backend/samples/*.wav (see "Demo audio" below); nothing to seed
npm run seed-demo-data   # optional: inserts synthetic calls for the Analyze/Ops pages (not shown on your Dashboard)
npm run dev              # starts backend on :3000

# frontend, in another terminal
cd ../frontend
npm install
cp .env.example .env
npm run dev              # starts frontend on :5173
```

Then I open http://localhost:5173.

## Deploying

- **Backend on Railway** — single Node service, set every var from `backend/.env.example`. Add the Postgres and Redis addons; Railway injects `DATABASE_URL` and `REDIS_URL` automatically. Start command: `npm run build && npm start`. WebSocket path is `/ws`.
- **Frontend on Cloudflare Pages** — connect the repo, set build command `npm run build`, output `dist/`, and set `VITE_API_BASE_URL` + `VITE_WS_URL` to the deployed Railway URL (use `wss://` for the WebSocket).

## How I demo this in 60 seconds

1. Open the dashboard. Point at the pipeline diagram and the health strip. "Every call is a case file."
2. Click **Run seeded demo**. Seven fault types fire; pipeline cards flash in sequence; recent calls populate with color-coded cause-of-death tags.
3. Click **Knock Deepgram offline (90s)** and then click a sample. The row appears with a purple `whisper *` badge. "We routed to Whisper automatically. Here's the cost delta."
4. Turn on **Chaos mode** at 12/min. The dashboard is now alive with continuous activity.
5. Click any failed row. Structured 4-section autopsy loads. Play the synthesized reply.
6. Jump to **Calibration**. Confusion matrix + precision/recall bars. "88% accuracy, measured against ground truth, not estimated."
7. Jump to **Blast radius**. Enter 10,000 calls/day. "At production scale that's $X/month of avoidable spend."

## Demo audio: where it comes from and how to add your own

The Dashboard needs real audio to analyze. Three ways to get it:

1. **Bundled demo calls** (nothing to do). `backend/samples/` ships five interview demo calls, from a clean baseline up to a failure-heavy multi-intent call, generated with OpenAI `tts-1`, plus four short quick clips. Pick one from the **Demo call** dropdown on the Dashboard; each shows what it is designed to stress and its script, and has a Play preview and an **Analyze this call** button. See `backend/samples/README.md`.
2. **Drop in your own.** Drag any `.wav` / `.mp3` / `.m4a` / `.ogg` / `.webm` / `.flac` file (up to 5 MB) onto the Dashboard, or click **Record** and speak. Good sources of realistic test audio: your own voice memos, a real call recording you have the right to use, or public speech datasets such as LibriSpeech and Mozilla Common Voice.
3. **Generate more.** Edit `backend/samples/manifest.json` and run `npm run generate-demo-calls -- --engine openai` (needs `OPENAI_API_KEY` and `ffmpeg`; uses `tts-1`, about 2 cents for all five calls). Without a key, omit `--engine` to render offline with `espeak-ng`.

The Dashboard's **Simulate a failure** section deliberately breaks one analysis (garbled audio, invented facts, a cut-off reply, a slow stage, ...) so you can watch it get diagnosed. It is off by default and switches itself off after one use.

## Your data is per-browser

There are no accounts. The first time you open the Dashboard your browser generates a random **workspace key** (a UUID kept in `localStorage`) and sends it with every request. Calls, audio, PDFs and live WebSocket events are all scoped to it, so one visitor never sees another's calls. Click **My workspace** in the top bar to copy your key, open the same workspace on another device, or start fresh.

This is isolation, not authentication: the key is a bearer secret. Anyone who has it can see that workspace, and clearing site data loses it if you did not save it. Each workspace is limited to 25 analyses per rolling 24 hours (`MAX_CALLS_PER_WORKSPACE_PER_DAY`) and 5 MB per upload (`MAX_UPLOAD_BYTES`). The Analyze, A/B and Ops pages still show system-wide data.

## What's deliberately out of scope

- Multi-turn conversation. Every call is single-turn — voice in, voice out. Adding conversation history would double the surface area without changing what the tool is actually about.
- Real authentication. Dashboard data is isolated per browser (see "Your data is per-browser"), but there are no logins, and the admin/chaos/outage and Analyze/A/B/Ops endpoints are still open. For a real launch I'd add accounts (or Cloudflare Access) and an admin token.
- Metrics scraping. The observability story here is per-call rows in Postgres + on-demand SQL, not a Prometheus histogram. Different tool for a different job.

## What I'd add next

- **Streaming transcription** so the transcript appears word-by-word instead of after the whole clip uploads.
- **Incident grouping** — merge N failed calls of the same type in the same window into one "incident" with a count.
- **Apply-suggestion loop** — take a self-healing suggestion, apply it as a config change, re-run A/B to prove it helped.

## License

MIT. See [LICENSE](LICENSE).
