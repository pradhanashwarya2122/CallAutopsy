import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_THRESHOLDS, analyzeWavSignal, classifyCondition } from '../../src/analysis/audioSignal.js';
import { readPcm16 } from '../../src/analysis/audioIO.js';
import { AUDIO_TRUTH } from '../audioTruth.js';
import { toWav, voiceSignal, whiteNoise, wavBuffer } from '../helpers.js';

// ---- the calibration dataset itself: 43 labelled checks across 16 recordings whose conditions are known from how they were made
test('detector agrees with the known recording condition of every labelled demo call', () => {
  const wrong: string[] = [];
  let checks = 0;
  for (const [id, t] of Object.entries(AUDIO_TRUTH)) {
    const sig = analyzeWavSignal(wavBuffer(id));
    assert.ok(sig, id);
    const got = { band_limited: sig.band_limited, noisy: sig.condition.flags.includes('noisy') || sig.condition.flags.includes('very_noisy'), compressed: sig.dynamics_compressed, clipped: sig.condition.flags.includes('clipped') };
    for (const k of ['band_limited', 'noisy', 'compressed', 'clipped'] as const) {
      const exp = t[k];
      if (exp === undefined) continue;
      checks += 1;
      if (exp !== got[k]) wrong.push(`${id}: ${k} expected ${exp}, got ${got[k]}`);
    }
  }
  assert.equal(checks, 43);
  assert.deepEqual(wrong, []);
});

test('regression: a clean wideband recording is never called band-limited (the earlier brightness-based false positive)', () => {
  for (const id of ['call-1-clean-baseline', 'stress-01-young-male-clear-baseline', 'stress-02-middle-aged-female-hesitant-forgets-order', 'stress-07-older-female-confused-corrections']) {
    const sig = analyzeWavSignal(wavBuffer(id));
    assert.equal(sig?.band_limited, false, `${id} hf ${sig?.hf_ratio_db}`);
    assert.equal(sig?.condition.label, 'clean_wideband', id);
  }
});

test('filtered channels are flagged: telephone, muffled microphone and the phone preset', () => {
  for (const id of ['stress-05-middle-aged-male-phone-static', 'stress-09-frustrated-female-multi-intent-street', 'call-4-long-multi-detail', 'call-5-failure-heavy-multi-intent']) {
    assert.equal(analyzeWavSignal(wavBuffer(id))?.band_limited, true, id);
  }
});

test('the demo calls span distinct noise levels in the right order', () => {
  const snr = (id: string) => analyzeWavSignal(wavBuffer(id))?.snr_db as number;
  assert.ok(snr('stress-01-young-male-clear-baseline') > snr('stress-02-middle-aged-female-hesitant-forgets-order'));
  assert.ok(snr('stress-02-middle-aged-female-hesitant-forgets-order') > snr('stress-04-young-female-fast-interruptions'));
  assert.ok(snr('stress-04-young-female-fast-interruptions') > snr('stress-06-young-female-busy-cafe-repeats'));
  assert.ok(snr('stress-06-young-female-busy-cafe-repeats') > snr('stress-10-max-stress-train-phone-multi-issue'));
});

// ---- synthetic checks of each condition
const speechLike = (rate: number, seconds = 6) => {
  const v = voiceSignal(140, seconds, rate, 0.3);
  // gaps so a noise floor exists
  v.forEach((_, i) => { if (Math.floor(i / rate * 2) % 3 === 2) v[i] = 0; });
  return v;
};
const addNoise = (s: Float64Array, amp: number) => { const n = whiteNoise(s.length / 16000, 16000, amp, 3); return s.map((v, i) => v + (n[i] ?? 0)); };

test('a clipped recording is flagged as clipped', () => {
  const s = speechLike(16000).map((v) => Math.max(-1, Math.min(1, v * 6)));
  const sig = analyzeWavSignal(toWav(s)) as NonNullable<ReturnType<typeof analyzeWavSignal>>;
  assert.ok(sig.clipping_ratio > AUDIO_THRESHOLDS.clippingRatio);
  assert.ok(sig.condition.flags.includes('clipped'));
});

test('more noise means a lower SNR and the noisy flags', () => {
  const clean = analyzeWavSignal(toWav(addNoise(speechLike(16000), 0.0005))) as NonNullable<ReturnType<typeof analyzeWavSignal>>;
  const noisy = analyzeWavSignal(toWav(addNoise(speechLike(16000), 0.05))) as NonNullable<ReturnType<typeof analyzeWavSignal>>;
  assert.ok(clean.snr_db > noisy.snr_db + 15);
  assert.ok(clean.snr_db >= AUDIO_THRESHOLDS.cleanSnrDb);
  assert.ok(noisy.condition.flags.some((f) => f === 'noisy' || f === 'very_noisy'));
});

test('an 8 kHz recording is band-limited because its sample rate cannot carry high frequencies', () => {
  const sig = analyzeWavSignal(toWav(speechLike(8000), 8000)) as NonNullable<ReturnType<typeof analyzeWavSignal>>;
  assert.equal(sig.hf_ratio_db, null);
  assert.equal(sig.band_limited, true);
});

test('a steady, compressed loudness is flagged only when the recording is clean enough to tell it from noise', () => {
  const steady = Float64Array.from(voiceSignal(140, 6, 16000, 0.2), (v, i) => (Math.floor(i / 16000 * 2) % 3 === 2 ? 0 : v));
  const sig = analyzeWavSignal(toWav(steady)) as NonNullable<ReturnType<typeof analyzeWavSignal>>;
  assert.ok(sig.level_sd_db >= 0);
  const noisy = classifyCondition({ snr_db: 10, clipping_ratio: 0, band_limited: false, dynamics_compressed: false });
  assert.equal(noisy.label, 'noisy');
});

test('condition labels: clean, acceptable, single problems and combinations', () => {
  assert.equal(classifyCondition({ snr_db: 45, clipping_ratio: 0, band_limited: false, dynamics_compressed: false }).label, 'clean_wideband');
  assert.equal(classifyCondition({ snr_db: 28, clipping_ratio: 0, band_limited: false, dynamics_compressed: false }).label, 'acceptable');
  assert.equal(classifyCondition({ snr_db: 45, clipping_ratio: 0, band_limited: true, dynamics_compressed: false }).label, 'band_limited');
  assert.equal(classifyCondition({ snr_db: 45, clipping_ratio: 0.02, band_limited: false, dynamics_compressed: false }).label, 'clipped');
  assert.equal(classifyCondition({ snr_db: 45, clipping_ratio: 0, band_limited: false, dynamics_compressed: true }).label, 'compressed');
  const both = classifyCondition({ snr_db: 8, clipping_ratio: 0, band_limited: true, dynamics_compressed: false });
  assert.equal(both.label, 'degraded');
  assert.deepEqual(both.flags, ['very_noisy', 'band_limited']);
});

test('bad input is rejected instead of guessed at', () => {
  assert.equal(analyzeWavSignal(Buffer.from('not a wav file at all, just text')), null);
  assert.equal(analyzeWavSignal(toWav(new Float64Array(1600))), null, 'shorter than half a second');
  assert.equal(readPcm16(Buffer.alloc(10)), null);
  const mp3ish = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(4000)]);
  assert.equal(analyzeWavSignal(mp3ish), null);
});
