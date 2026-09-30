// Every number on the landing page comes from this file, and every value here was measured on the real pipeline.
//   RUNS  : two live calls captured on 2026-09-30 with backend/bench/capture-landing.mjs (call-1-clean-baseline.wav; the second run
//           has the "timeout" fault injected). Times are seconds from the start of speech-to-text.
//   AB    : one live A/B run of the same call, 3 runs per side, decided by backend/src/abTesting/verdict.ts.
//   FAULTS: rule order and thresholds from backend/src/classifier/rules.ts; results from backend/bench/results/fault.json.
//   FACTS : figures copied from backend/bench/results/MATRIX.md.
// Change a value here only by re-running the capture or benchmark that produced it.

export const RUNS = {
  clean: {
    label: 'Clean call',
    fault: null,
    verdict: 'No failure',
    category: 'ok',
    confidence: 0.9,
    reason: 'No failure signals were raised.',
    total: 0.003611,
    span: 5.0,
    stages: [
      { id: 'stt', name: 'STT', tool: 'Deepgram nova-3', start: 0, end: 1.39, status: 'ok', cost: 0.001101, note: '33 words, average confidence 0.999' },
      { id: 'llm', name: 'LLM', tool: 'gpt-4o-mini', start: 1.433, end: 2.868, status: 'ok', cost: 0.000034, note: '121 prompt + 27 completion tokens' },
      { id: 'tts', name: 'TTS', tool: 'OpenAI tts-1', start: 2.87, end: 4.122, status: 'ok', cost: 0.00204, note: '136 characters, 137,856 bytes of audio' },
    ],
    analysis: { seconds: 5.549, cost: 0.000435 },
    evidence: [
      'Every stage finished inside its limit (STT 5 s, LLM 8 s, TTS 5 s).',
      'Speech-to-text confidence was 0.999, far above the failure threshold.',
      'The reply was synthesized to audio of the expected length.',
    ],
  },
  timeout: {
    label: 'Timeout injected',
    fault: 'timeout',
    verdict: 'Timeout',
    category: 'timeout',
    confidence: 0.95,
    reason: 'stage llm exceeded SLA (13350ms > 8000ms)',
    total: 0.00396,
    span: 19,
    stages: [
      { id: 'stt', name: 'STT', tool: 'Deepgram nova-3', start: 0, end: 1.21, status: 'ok', cost: 0.001101, note: '33 words, average confidence 0.999' },
      { id: 'llm', name: 'LLM', tool: 'gpt-4o-mini', start: 1.255, end: 14.605, status: 'timeout', cost: 0.000039, note: '13.350 s against an 8 s limit' },
      { id: 'tts', name: 'TTS', tool: 'OpenAI tts-1', start: 14.608, end: 18.799, status: 'ok', cost: 0.002385, note: 'ran anyway: the late reply was still voiced' },
    ],
    analysis: { seconds: 7.296, cost: 0.000435 },
    evidence: [
      'The LLM stage took 13.350 s. Its limit is 8 s.',
      'Speech-to-text finished in 1.210 s with confidence 0.999, so it is cleared.',
      'The reply only reached text-to-speech 14.6 s in, and TTS still ran, so the caller waited that long.',
    ],
  },
};

// Priority order: the first matching rule wins, so a call has exactly one primary cause.
export const DETECTORS = [
  { k: 'network_drop', by: 'Rule', signal: 'A websocket close event was received.', conf: 1.0 },
  { k: 'user_hangup', by: 'Rule', signal: 'A user cancellation signal was received.', conf: 1.0 },
  { k: 'exception', by: 'Rule', signal: 'A stage raised an unhandled error (null payload, type error, range error).', conf: 0.95 },
  { k: 'timeout', by: 'Rule', signal: 'A stage passed its limit (STT 5 s, LLM 8 s, TTS 5 s) or reported a timeout.', conf: 0.95 },
  { k: 'hallucination', by: 'Second model', signal: 'A grounding check judged the reply unsupported by what the caller said.', conf: 0.85 },
  { k: 'bad_stt', by: 'Rule', signal: 'The transcript was empty, or its average confidence fell below the provider threshold.', conf: 0.9 },
  { k: 'tts_glitch', by: 'Rule', signal: 'The synthesized audio length did not match the reply text.', conf: 0.8 },
];

// Injected fault -> what the classifier said, 3 calls per fault (bench/results/fault.json).
export const CONFUSION = [
  { k: 'bad_stt', got: ['bad_stt', 'bad_stt', 'bad_stt'] },
  { k: 'tts_glitch', got: ['tts_glitch', 'tts_glitch', 'tts_glitch'] },
  { k: 'timeout', got: ['timeout', 'timeout', 'timeout'] },
  { k: 'user_hangup', got: ['user_hangup', 'user_hangup', 'user_hangup'] },
  { k: 'network_drop', got: ['network_drop', 'network_drop', 'network_drop'] },
  { k: 'exception', got: ['exception', 'exception', 'exception'] },
  { k: 'hallucination', got: ['timeout', 'ok', 'timeout'] },
];

export const LIMITS = [
  ['Hallucination is the weak spot.', 'It was diagnosed 0 of 3 times. Forcing the model to invent things made two replies slow enough to be called timeouts first, and one reply was simply not wrong. The verdict depends on the model behaving badly on cue.'],
  ['Confidence is the rule, not a probability.', 'Each rule returns a fixed number (0.80 to 1.00). It tells you which rule fired, not how likely the diagnosis is to be right.'],
  ['The scores are in-sample.', 'Audio quality (43 of 43) and speaker separation were tuned on these same demo calls, so they will look worse on recordings the tuning never saw.'],
  ['Mono recordings hide overlap.', 'Only 3 of 10 scripted interruptions were found, with no false alarms. Every report treats the overlap count as a lower bound.'],
  ['Noisy calls cost accuracy.', 'Three of the fifteen scripted calls had a word error rate of 16 to 19 percent, above the 10 percent bar.'],
  ['Uploaded calls are read, not replayed.', 'A call you upload gets audio analysis. Only the demo calls can have a fault injected and be run through the pipeline again.'],
];

export const AB = {
  sample: 'call-1-clean-baseline',
  runs: 3,
  a: { name: 'Config A', stack: 'Deepgram + gpt-4o-mini', failed: 0, latency: 4.1, cost: 0.0036, wer: 0 },
  b: { name: 'Config B', stack: 'Whisper + gpt-4o', failed: 1, latency: 5.7, cost: 0.005, wer: 0 },
  headline: 'Config A is faster and cheaper, with no quality difference.',
  rows: [
    { label: 'Failed calls', a: '0 of 3', b: '1 of 3', counts: false, why: 'One failure in three runs is under the half-of-the-runs gap the rules require, so it is not counted.' },
    { label: 'Word error rate', a: '0%', b: '0%', counts: false, why: 'Both transcripts matched the script. The gap has to reach 3 points to count.' },
    { label: 'Pipeline time', a: '4.1 s', b: '5.7 s', counts: 'A', why: 'Every completed run of A beat every completed run of B.' },
    { label: 'Cost per call', a: '$0.0036', b: '$0.0050', counts: 'A', why: 'Every run of A cost less than every run of B.' },
  ],
  rules: [
    'A gap only counts if it is big enough to matter: 10% for time and cost, 3 points of word error, half the runs for failures.',
    'The runs must not overlap: the slowest run of the winner has to beat the fastest run of the loser.',
    'Each side needs at least 2 finished calls. Fewer gives "not enough runs".',
    'Quality outranks speed and cost. If each side wins a different quality measure, the answer is "no single winner".',
    'Time and cost come from completed calls only, so a call that died early cannot look cheap.',
  ],
};

export const FACTS = {
  speakers: ['19 of 19', '16 of 19'], // speaker count correct: CallAutopsy vs the speech recogniser alone
  wordSpeaker: ['0.990', '0.777'], // word-level speaker accuracy on the 4 two-voice calls (in-sample)
  interruptions: '3 of 10',
  audioQuality: '43 of 43',
  analysisCall: {
    speakers: 1, words: 33, wpm: 133, snr: 39.9, condition: 'clean wideband', overlap: 0,
    finding: 'Two related issues raised: duplicate charge and refund request',
    tone: 'Animated delivery (voice only, low confidence). The words show no clear emotion.',
  },
};

// The 19 demo calls (15 recorded + 4 short clips) as they ran through the live pipeline on 2026-09-30
// (backend/bench/results/regression-live.json): [call, diagnosis, STT provider, seconds start to finish, cost in USD].
export const RECORDED = [["call-1", "ok", "deepgram", 6.8, 0.00313], ["call-2", "ok", "deepgram", 12.6, 0.00282], ["call-3", "ok", "deepgram", 6.6, 0.00404], ["call-4", "ok", "deepgram", 8.1, 0.00589], ["call-5", "ok", "deepgram", 12.6, 0.00447], ["stress-01", "ok", "deepgram", 6.5, 0.00334], ["stress-02", "ok", "deepgram", 6.6, 0.0045], ["stress-03", "ok", "deepgram", 6.6, 0.00487], ["stress-04", "ok", "deepgram", 6.6, 0.0038], ["stress-05", "ok", "deepgram", 6.6, 0.00477], ["stress-06", "ok", "deepgram", 6.7, 0.00481], ["stress-07", "ok", "deepgram", 8.2, 0.00554], ["stress-08", "ok", "deepgram", 6.6, 0.00434], ["stress-09", "ok", "deepgram", 8.1, 0.00625], ["stress-10", "ok", "deepgram", 8.2, 0.00674], ["refund-request", "ok", "deepgram", 5.1, 0.00277], ["book-table", "ok", "deepgram", 5, 0.00151], ["weather-today", "ok", "deepgram", 3.5, 0.00206], ["noisy-line", "bad_stt", "deepgram", 5, 0.00182]];
