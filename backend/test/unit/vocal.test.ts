import test from 'node:test';
import assert from 'node:assert/strict';
import { composeTone, measureVoices, type SpeakerVoice } from '../../src/analysis/vocal.js';
import { diarize } from '../../src/analysis/diarize.js';
import { analyzeWavSignal } from '../../src/analysis/audioSignal.js';
import { framesOf, sttFixture, wavBuffer } from '../helpers.js';

const voicesOf = (id: string) => {
  const stt = sttFixture(id);
  const fr = framesOf(id);
  return measureVoices(stt.words, diarize(stt.words, fr), fr, analyzeWavSignal(wavBuffer(id)));
};

test('the recorded delivery follows the measurements: the frustrated street call is animated; the compressed phone call makes no loudness-based claim', () => {
  const s9 = voicesOf('stress-09-frustrated-female-multi-intent-street')[0];
  assert.equal(s9.arousal, 'high');
  assert.ok(s9.cues.some((c) => c.id === 'fast') && s9.cues.some((c) => c.id === 'wide_pitch'));
  const s5 = voicesOf('stress-05-middle-aged-male-phone-static')[0];
  assert.ok(!s5.cues.some((c) => c.id === 'steady_loudness' || c.id === 'loudness_swings'), 'a compressor flattens loudness, so loudness says nothing about the speaker');
  assert.notEqual(s5.arousal, 'high', 'and a calm, careful delivery is never reported as animated');
});

test('a hesitant speaker shows hesitation cues from measured pauses and fillers', () => {
  const s2 = voicesOf('stress-02-middle-aged-female-hesitant-forgets-order')[0];
  assert.ok(s2.cues.some((c) => c.id === 'hesitant'));
  assert.ok(s2.measurements.filler_count >= 3);
  const s8 = voicesOf('stress-08-nervous-male-long-pauses-ambiguous')[0];
  assert.ok(s8.measurements.long_pauses >= 2);
});

test('too noisy to judge: no activation level is claimed, and the reason says why', () => {
  const s10 = voicesOf('stress-10-max-stress-train-phone-multi-issue').filter((v) => v.words >= 50)[0];
  assert.equal(s10.arousal, 'unclear');
  assert.match(s10.reason, /too noisy/);
});

test('no voice measurement claims high confidence, and any claim on a noisy call is at most low', () => {
  for (const id of ['stress-04-young-female-fast-interruptions', 'stress-06-young-female-busy-cafe-repeats', 'stress-09-frustrated-female-multi-intent-street', 'call-4-long-multi-detail']) {
    for (const v of voicesOf(id)) {
      assert.notEqual(v.confidence, 'high');
      if (v.arousal !== 'unclear') assert.ok(['low', 'medium'].includes(v.confidence));
    }
  }
});

test('with two voices each is measured separately, and too little speech gives no reading', () => {
  const v = voicesOf('stress-09-frustrated-female-multi-intent-street');
  assert.equal(v.length, 2);
  assert.notEqual(v[0].measurements.pitch_hz, v[1].measurements.pitch_hz);
  assert.equal(v[1].arousal, 'unclear');
  assert.match(v[1].reason, /too little|Only/);
});

test('no audio analysis means no voice measurements at all', () => {
  const stt = sttFixture('call-1-clean-baseline');
  assert.deepEqual(measureVoices(stt.words, diarize(stt.words, null), null, null), []);
});

// ---- composing the three readings
const voice = (arousal: SpeakerVoice['arousal'], hesitant = false, confidence: SpeakerVoice['confidence'] = 'medium'): SpeakerVoice => ({
  speaker: 0, words: 50, speech_s: 30, measurements: { pitch_hz: 150, pitch_range_st: 8, loudness_sd_db: 5, articulation_wpm: 150, pause_ratio: 0.1, long_pauses: 0, fillers_per_min: 0, filler_count: 0 },
  cues: hesitant ? [{ id: 'hesitant', text: 'hesitant delivery' }] : [], arousal, confidence, reason: 'r',
});
const lex = (emotion: string, intensity: 'low' | 'medium' | 'high' = 'medium') => ({ emotion, valence: 'negative', intensity, evidence: 'quote' });

test('tone: nothing clear from either source is "not evident", never a default "neutral"', () => {
  const t = composeTone(lex('not_evident'), voice('unclear'));
  assert.equal(t.overall.label, 'not evident'); assert.equal(t.overall.agreement, 'insufficient'); assert.equal(t.overall.confidence, 'low');
  assert.equal(composeTone(lex('neutral'), voice('unclear')).overall.label, 'not evident');
});

test('tone: words and voice that agree are a stronger (but still capped) reading', () => {
  const t = composeTone(lex('frustrated', 'high'), voice('high'));
  assert.equal(t.overall.label, 'frustrated'); assert.equal(t.overall.agreement, 'agree'); assert.equal(t.overall.confidence, 'medium');
  const weak = composeTone(lex('frustrated', 'high'), voice('high', false, 'low'));
  assert.equal(weak.overall.confidence, 'low');
});

test('tone: words and voice that disagree are reported as mixed signals, at low confidence', () => {
  const t = composeTone(lex('frustrated'), voice('low'));
  assert.equal(t.overall.agreement, 'differ'); assert.equal(t.overall.confidence, 'low'); assert.match(t.overall.label, /^mixed signals/);
});

test('tone: one source only is labelled as such, and the voice alone never names a feeling', () => {
  const wordsOnly = composeTone(lex('nervous'), voice('unclear'));
  assert.equal(wordsOnly.overall.agreement, 'words_only'); assert.equal(wordsOnly.overall.confidence, 'low');
  const voiceOnly = composeTone(lex('neutral'), voice('high'));
  assert.equal(voiceOnly.overall.agreement, 'voice_only');
  assert.match(voiceOnly.overall.label, /delivery/);
  assert.equal(composeTone(null, voice('high')).overall.agreement, 'voice_only');
  assert.equal(composeTone(lex('confused'), null).overall.agreement, 'words_only');
});

test('tone: the three readings are kept separate in the result', () => {
  const t = composeTone(lex('frustrated'), voice('high', true));
  assert.equal(t.lexical?.emotion, 'frustrated');
  assert.equal(t.vocal?.arousal, 'high'); assert.equal(t.vocal?.hesitant, true);
  assert.ok(t.overall.basis.length > 10);
});
