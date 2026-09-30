// Assembles bench/results/MATRIX.md from the result files the benchmarks wrote (real outputs, nothing typed in by hand).
//   npx tsx bench/build-matrix.ts
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const read = (f: string) => JSON.parse(fs.readFileSync(`bench/results/${f}`, 'utf8'));
const reg = read('regression-live.json');
const ana = read('analysis.json');
const dia = read('diarization.json');
const ovl = read('overlap.json');
const aud = read('audio-quality.json');
const bg = read('background.json');
const flt = read('fault.json');

const m = (matrix: Record<string, { ok: number; total: number; notes: string[] }>, key: string) => matrix[key];
const cell = (t?: { ok: number; total: number }) => (t ? `${t.ok}/${t.total} (${Math.round((t.ok / t.total) * 100)}%)` : 'n/a');
const notes = (t?: { notes: string[] }) => (t && t.notes.length ? t.notes.join('; ') : 'none');
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const rows: string[][] = [];
const add = (category: string, measure: string, live: string, offline: string, failures: string) => rows.push([category, measure, live, offline, failures]);
const R = reg.matrix;
const A = ana.matrix;

add('STT', 'Numbers heard exactly (15 scripted calls)', cell(m(R, 'STT: numbers heard exactly')), cell(m(A, 'STT: numbers heard exactly')), notes(m(R, 'STT: numbers heard exactly')));
add('WER', 'Normalized WER <= 10%', cell(m(R, 'STT: normalized WER <= 10%')), cell(m(A, 'STT: normalized WER <= 10%')), notes(m(R, 'STT: normalized WER <= 10%')));
add('WER', 'Mean WER, normalized / strict (%)', `${mean(reg.perCall.map((c: any) => c.wer)).toFixed(1)} / ${mean(reg.perCall.map((c: any) => c.werStrict)).toFixed(1)}`, `${mean(ana.perCall.map((c: any) => c.wer)).toFixed(1)} / ${mean(ana.perCall.map((c: any) => c.werStrict)).toFixed(1)}`, 'errors are audio-limited: Deepgram output is not identical between runs');
add('Diarization', 'Speaker count correct (calls in the live/analysis set)', cell(m(R, 'Diarization: speaker count')), `${dia.filter((r: any) => r.truthSpk === r.oursSpk).length}/${dia.length} on all 19 calls (recogniser alone: ${dia.filter((r: any) => r.truthSpk === r.recogSpk).length}/${dia.length})`, notes(m(R, 'Diarization: speaker count')));
const two = dia.filter((r: any) => r.truthSpk === 2);
add('Diarization', 'Word-level speaker accuracy, two-voice calls (ours / recogniser)', 'n/a (needs scripted timeline)', `${mean(two.map((r: any) => Number(r.oursAcc))).toFixed(3)} / ${mean(two.map((r: any) => Number(r.recogAcc))).toFixed(3)}`, 'in-sample: thresholds were tuned on these 4 calls');
add('Speaker attribution', 'Agent-only values not credited to the customer / reported as agent-stated', `${cell(m(R, 'Attribution: agent-only values not credited to the customer'))} / ${cell(m(R, 'Attribution: agent-only values reported as agent-stated'))}`, `${cell(m(A, 'Attribution: agent-only values not credited to the customer'))} / ${cell(m(A, 'Attribution: agent-only values reported as agent-stated'))}`, 'one call has an agent-only value');
add('Intent', 'Primary intent correct', cell(m(R, 'Intent: primary correct')), cell(m(A, 'Intent: primary correct')), notes(m(R, 'Intent: primary correct')));
add('Intent', 'All expected further intents found', cell(m(R, 'Intent: all expected further intents found')), cell(m(A, 'Intent: all expected further intents found')), notes(m(R, 'Intent: all expected further intents found')));
add('Entities', 'Customer details found', cell(m(R, 'Entities: customer details found')), cell(m(A, 'Entities: customer details found')), notes(m(R, 'Entities: customer details found')));
add('Entities', 'No invented or merged values', cell(m(R, 'Entities: no invented or merged values')), cell(m(A, 'Entities: no invented or merged values')), notes(m(R, 'Entities: no invented or merged values')));
add('Entities', 'Self-corrections captured', cell(m(R, 'Corrections: self-corrections captured')), cell(m(A, 'Corrections: self-corrections captured')), notes(m(R, 'Corrections: self-corrections captured')));
add('Emotion (words)', 'Asserted and consistent with styled delivery / abstained', `${cell(m(R, 'Emotion (words): asserted and consistent with styled delivery'))} / ${cell(m(R, 'Emotion (words): abstained (none evident in the wording)'))}`, `${cell(m(A, 'Emotion (words): asserted and consistent with styled delivery'))} / ${cell(m(A, 'Emotion (words): abstained (none evident in the wording)'))}`, notes(m(R, 'Emotion (words): asserted and consistent with styled delivery')));
add('Emotion (overall)', 'Asserted and consistent / abstained or flagged mixed', `${cell(m(R, 'Emotion (overall): asserted and consistent with styled delivery'))} / ${cell(m(R, 'Emotion (overall): abstained or flagged mixed'))}`, `${cell(m(A, 'Emotion (overall): asserted and consistent with styled delivery'))} / ${cell(m(A, 'Emotion (overall): abstained or flagged mixed'))}`, notes(m(R, 'Emotion (overall): asserted and consistent with styled delivery')));
add('Emotion (voice)', 'Activation claimed and correct / abstained (3 calls with an unambiguous style)', `${cell(m(R, 'Vocal arousal: claimed and correct'))} / ${cell(m(R, 'Vocal arousal: abstained (no claim)'))}`, `${cell(m(A, 'Vocal arousal: claimed and correct'))} / ${cell(m(A, 'Vocal arousal: abstained (no claim)'))}`, 'synthetic delivery styles, not human emotion');
add('Interruptions', 'Scripted events found (10) / false alarms', 'n/a', `${ovl.detected}/${ovl.truthEvents} found (recall ${(ovl.detected / ovl.truthEvents).toFixed(2)}), ${ovl.falseAlarms} false alarms`, 'mono recordings hide most overlap: a lower bound, stated in every report');
add('Findings', 'Expected findings present / no false alarms', `${cell(m(R, 'Findings: expected finding present'))} / ${cell(m(R, 'Findings: no false alarm'))}`, `${cell(m(A, 'Findings: expected finding present'))} / ${cell(m(A, 'Findings: no false alarm'))}`, notes(m(R, 'Findings: expected finding present')));
add('Audio quality', 'Labelled recording-condition checks', 'n/a', `${aud.right}/${aud.checks}`, aud.wrong.length ? aud.wrong.join('; ') : 'none (in-sample calibration)');
add('Background speech', 'Environment words flagged / scripted words wrongly flagged', 'n/a', `${bg.flagged}/${bg.environmentWords} flagged, ${bg.scriptedWordsWronglyFlagged} wrongly flagged`, 'the shipped calls contain almost no transcribed environment speech (3 boundary words), so this is barely measurable on real data; the logic is covered by synthetic scenes in test/unit/diarization.test.ts');
const tests = (file: string) => { try { const out = execSync(`node --import tsx --test ${file}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return `${/# pass (\d+)/.exec(out)?.[1]}/${/# tests (\d+)/.exec(out)?.[1]}`; } catch (e: any) { const out = String(e.stdout ?? ''); return `${/# pass (\d+)/.exec(out)?.[1] ?? '?'}/${/# tests (\d+)/.exec(out)?.[1] ?? '?'} (FAILING)`; } };
add('Redaction', 'Unit tests of every redaction path (mutation-checked); API tests of the read path and PDF', 'n/a', `${tests('test/unit/redaction.test.ts')} unit; the API test "raw personal details ... PDF" is in test/api/api.test.ts`, 'spoken personal details inside the stored audio are not redacted, only text');
const det = flt.rows.filter((r: any) => r.fault !== 'hallucination');
const hall = flt.rows.filter((r: any) => r.fault === 'hallucination');
add('Fault classification', 'Deterministic faults diagnosed as injected (6 types x 3 calls)', 'n/a', `${det.filter((r: any) => r.correct).length}/${det.length}`, det.filter((r: any) => !r.correct).map((r: any) => `${r.sample} ${r.fault} -> ${r.diagnosed}`).join('; ') || 'none');
add('Fault classification', 'Hallucination (model-dependent) diagnosed', 'n/a', `${hall.filter((r: any) => r.correct).length}/${hall.length}`, hall.filter((r: any) => !r.correct).map((r: any) => `${r.sample} -> ${r.diagnosed}`).join('; ') || 'none');
const okCalls = reg.runtime.filter((x: any) => x.status === 'completed' && x.category === 'ok' && x.analysis).length;
add('Pipeline', 'Demo calls that complete ok with an analysis (19 through the real API)', `${okCalls}/${reg.runtime.length}`, 'n/a', reg.runtime.filter((x: any) => !(x.status === 'completed' && x.category === 'ok' && x.analysis)).map((x: any) => `${x.id.trim()}: ${x.category}${x.failover ? ' (Deepgram failed, Whisper answered)' : ''}`).join('; ') || 'none');

const head = '| Category | Measure | Live pipeline (real API) | Stored real STT + real model | Failures |\n| --- | --- | --- | --- | --- |\n';
const md = `# Accuracy and error matrix\n\nGenerated by \`bench/build-matrix.ts\` from the result files in \`bench/results/\`. "Live pipeline" sends each demo call through the running backend (real Deepgram, real OpenAI) and scores the stored result; "stored real STT" runs the analysis on recorded real Deepgram output so it is repeatable. Ground truth is \`test/groundTruth.ts\`, \`test/audioTruth.ts\` and \`samples/truth/\`.\n\n${head}${rows.map((r) => `| ${r.join(' | ')} |`).join('\n')}\n`;
fs.writeFileSync('bench/results/MATRIX.md', md);
console.log(md);
