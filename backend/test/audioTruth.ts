// Ground truth for the recording conditions of the bundled demo calls, taken from how they were rendered
// (samples/manifest.json `post` and the presets in scripts/generate-demo-calls.mjs). A key that is absent means the condition
// was not specified for that call and is not checked.
//   band_limited: a low-pass at or below 4.5 kHz was applied to the speech (phone / muffled microphone / compressed line)
//   noisy: the target speech-to-noise ratio was 24 dB or lower (calls rendered at 27 dB or more count as not noisy)
//   compressed: a dynamics compressor / AGC-style chain was applied to the whole call
//   clipped: no call is clipped
export interface Truth { band_limited?: boolean; noisy?: boolean; compressed?: boolean; clipped?: boolean; note: string }
export const AUDIO_TRUTH: Record<string, Truth> = {
  'call-1-clean-baseline': { noisy: false, clipped: false, note: 'clean preset' },
  'call-2-noisy-cafe': { noisy: true, clipped: false, note: 'cafe, ~10 dB above noise' },
  'refund-request': { band_limited: true, clipped: false, note: 'low-rate synthetic voice: spectrum stops at ~5 kHz' },
  'weather-today': { band_limited: true, clipped: false, note: 'low-rate synthetic voice: spectrum stops at ~5 kHz' },
  'call-4-long-multi-detail': { band_limited: true, clipped: false, note: 'phone preset' },
  'call-5-failure-heavy-multi-intent': { band_limited: true, clipped: false, note: 'phone preset' },
  'stress-01-young-male-clear-baseline': { band_limited: false, noisy: false, compressed: false, clipped: false, note: 'studio, no noise' },
  'stress-02-middle-aged-female-hesitant-forgets-order': { band_limited: false, noisy: false, clipped: false, note: 'quiet room 38 dB' },
  'stress-03-older-male-slow-noisy-repeats-amount': { band_limited: false, noisy: true, clipped: false, note: 'home TV 22 dB, distant mic (6.5 kHz low-pass)' },
  'stress-04-young-female-fast-interruptions': { band_limited: false, noisy: true, clipped: false, note: 'office 21 dB' },
  'stress-05-middle-aged-male-phone-static': { band_limited: true, noisy: true, compressed: true, clipped: false, note: 'telephone channel: 300-3400 Hz + compressor' },
  'stress-06-young-female-busy-cafe-repeats': { band_limited: false, noisy: true, clipped: false, note: 'cafe 14 dB, distant mic (6.5 kHz low-pass)' },
  'stress-07-older-female-confused-corrections': { band_limited: false, noisy: false, clipped: false, note: 'quiet reverberant room 40 dB' },
  'stress-08-nervous-male-long-pauses-ambiguous': { band_limited: false, noisy: false, clipped: false, note: 'intermittent hiss 27 dB' },
  'stress-09-frustrated-female-multi-intent-street': { band_limited: true, noisy: true, clipped: false, note: 'street 16 dB, muffled mic (3 kHz low-pass)' },
  'stress-10-max-stress-train-phone-multi-issue': { noisy: true, clipped: false, note: 'train 12 dB + compressed line (4.5 kHz low-pass); codec noise hides the band limit and the compression, so those are not scored' },
};
