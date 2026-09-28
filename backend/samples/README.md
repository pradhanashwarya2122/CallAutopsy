# Bundled demo samples

Drop `.wav`, `.mp3`, or `.ogg` clips in this folder. Suggested set:

- `clean-1.wav` — clear speech ("What's the weather today?")
- `clean-2.wav` — clear speech ("Book me a table for two at seven")
- `noisy-1.wav` — a clip with background noise / distortion for triggering `bad_stt` even without fault injection

Any file in this directory can be referenced by name via `POST /calls` with `{"sampleId":"clean-1.wav"}`.
