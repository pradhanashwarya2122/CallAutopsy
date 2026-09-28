import { randomUUID } from 'crypto';
import { query } from '../db/client.js';
import { transcribe, type SttOutcome } from './stt/index.js';
import { llmTurn } from './llm.js';
import { synthesize } from './tts.js';
import {
  ALL_FAULTS,
  MILD_ADVERSARIAL,
  AGGRESSIVE_ADVERSARIAL,
  InjectedError,
  corruptAudio,
  delay,
  truncateForTts,
  resolveParams,
  type FaultType,
  type FaultParams,
} from './faultInjection.js';
import { classify, type StageRecord } from '../classifier/rules.js';
import { STT_CONFIDENCE_THRESHOLD, sttConfidenceSignal } from '../classifier/sttQuality.js';
import { ttsDurationMismatch } from '../classifier/ttsQuality.js';
import { detectHallucination } from '../classifier/grounding.js';
import { costForStage } from '../cost/calculator.js';
import { addSessionSpend } from '../cost/budget.js';
import { redactPII } from '../redaction/piiRedactor.js';
import { broadcast } from '../websocket/broadcaster.js';
import { generateAutopsyReport } from '../autopsy/generateReport.js';
import { saveInputAudio, saveTtsAudio } from '../storage/audioStore.js';

export interface RunCallOpts {
  callId?: string;
  audio: Buffer;
  inputSource: 'sample' | 'live_mic';
  sampleId?: string;
  faultType?: FaultType | null;
  faultParams?: FaultParams;
  audioExt?: string;
  config?: { llmModel?: string; preferredSttProvider?: 'deepgram' | 'whisper' };
  abRunId?: string;
}

const SLA = {
  stt: Number(process.env.STAGE_SLA_STT_MS) || 5000,
  llm: Number(process.env.STAGE_SLA_LLM_MS) || 8000,
  tts: Number(process.env.STAGE_SLA_TTS_MS) || 5000,
};

async function insertStage(
  callId: string,
  stage: 'stt' | 'llm' | 'tts',
  provider: string | null,
  startedAt: Date,
  endedAt: Date,
  status: 'ok' | 'error' | 'timeout',
  rawMeta: any,
  costUsd: number,
) {
  await query(
    `INSERT INTO call_stages (call_id, stage, provider, started_at, ended_at, duration_ms, status, raw_meta, cost_usd)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [callId, stage, provider, startedAt, endedAt, endedAt.getTime() - startedAt.getTime(), status, rawMeta, costUsd],
  );
}

function throwForStage(faultType: FaultType | null, params: FaultParams | undefined, stage: 'stt' | 'llm' | 'tts') {
  if (!faultType) return;
  if (faultType === 'network_drop') {
    const p = resolveParams('network_drop', params?.network_drop);
    if (p.stage === stage) throw new InjectedError('network_drop', `network drop at ${stage}`);
  }
  if (faultType === 'user_hangup') {
    const p = resolveParams('user_hangup', params?.user_hangup);
    if (p.stage === stage) throw new InjectedError('user_hangup', `user hangup at ${stage}`);
  }
  if (faultType === 'exception') {
    const p = resolveParams('exception', params?.exception);
    if (p.stage === stage) {
      if (p.kind === 'type_error') throw new TypeError(`injected type error at ${stage}`);
      if (p.kind === 'range_error') throw new RangeError(`injected range error at ${stage}`);
      throw new InjectedError('exception', `injected null payload at ${stage}`);
    }
  }
}

export async function runCall(opts: RunCallOpts): Promise<{ callId: string }> {
  const callId = opts.callId ?? randomUUID();
  const startedAt = new Date();

  if (opts.callId) {
    await query(`UPDATE calls SET status='in_progress', started_at=$2 WHERE id=$1`, [callId, startedAt]);
  } else {
    await query(
      `INSERT INTO calls (id, started_at, status, input_source, sample_id, injected_fault, ab_run_id)
       VALUES ($1,$2,'in_progress',$3,$4,$5,$6)`,
      [callId, startedAt, opts.inputSource, opts.sampleId ?? null, opts.faultType ?? null, opts.abRunId ?? null],
    );
  }
  saveInputAudio(callId, opts.audio, opts.audioExt ?? 'bin').catch(() => {});
  broadcast({ type: 'call.started', callId, faultType: opts.faultType, inputSource: opts.inputSource });

  const stages: StageRecord[] = [];
  let sttResult: SttOutcome | null = null;
  let llmText = '';
  let llmMeta: any = null;
  let ttsResult: Awaited<ReturnType<typeof synthesize>> | null = null;
  let exceptionType: string | undefined;
  let hangupSignaled = false;
  let networkDropSignaled = false;
  let hallucinated = false;
  let totalCost = 0;

  const faultType = opts.faultType ?? null;
  const faultParams = opts.faultParams;

  try {
    // STT
    {
      const startedAtStage = new Date();
      let audio = opts.audio;
      let status: 'ok' | 'error' | 'timeout' = 'ok';
      try {
        if (faultType === 'bad_stt') {
          const p = resolveParams('bad_stt', faultParams?.bad_stt);
          audio = corruptAudio(audio, p.corruptionPct, p.stride);
        }
        if (faultType === 'timeout') {
          const p = resolveParams('timeout', faultParams?.timeout);
          if (p.stage === 'stt') {
            await delay(SLA.stt + (p.extraDelayMs ?? 3000));
            status = 'timeout';
          }
        }
        throwForStage(faultType, faultParams, 'stt');
        if (faultType === 'network_drop') networkDropSignaled = true;
        if (faultType === 'user_hangup') hangupSignaled = true;

        sttResult = await transcribe(audio, {
          preferredProvider: opts.config?.preferredSttProvider ?? 'deepgram',
        });
      } catch (e) {
        status = status === 'timeout' ? 'timeout' : 'error';
        exceptionType = (e as Error).name;
        if (e instanceof InjectedError && e.faultType === 'network_drop') networkDropSignaled = true;
        if (e instanceof InjectedError && e.faultType === 'user_hangup') hangupSignaled = true;
        const endedAtStage = new Date();
        await insertStage(callId, 'stt', null, startedAtStage, endedAtStage, status, { error: (e as Error).message }, 0);
        stages.push({ stage: 'stt', durationMs: endedAtStage.getTime() - startedAtStage.getTime(), status, errorType: exceptionType });
        broadcast({ type: 'call.stage', callId, stage: 'stt', status });
        throw e;
      }
      const endedAtStage = new Date();
      const cost = costForStage({ stage: 'stt', provider: sttResult.provider, rawMeta: sttResult.rawMeta });
      totalCost += cost;
      await insertStage(callId, 'stt', sttResult.provider, startedAtStage, endedAtStage, status,
        { ...sttResult.rawMeta, failoverOccurred: sttResult.failoverOccurred, transcript_len: sttResult.transcript.length },
        cost);
      stages.push({ stage: 'stt', durationMs: endedAtStage.getTime() - startedAtStage.getTime(), status });
      broadcast({ type: 'call.stage', callId, stage: 'stt', status, provider: sttResult.provider });
    }

    // LLM
    {
      const startedAtStage = new Date();
      let status: 'ok' | 'error' | 'timeout' = 'ok';
      try {
        if (faultType === 'timeout') {
          const p = resolveParams('timeout', faultParams?.timeout);
          if (p.stage === 'llm') {
            await delay(SLA.llm + (p.extraDelayMs ?? 3000));
            status = 'timeout';
          }
        }
        throwForStage(faultType, faultParams, 'llm');
        if (faultType === 'network_drop' && resolveParams('network_drop', faultParams?.network_drop).stage === 'llm') networkDropSignaled = true;
        if (faultType === 'user_hangup' && resolveParams('user_hangup', faultParams?.user_hangup).stage === 'llm') hangupSignaled = true;

        let systemPrompt: string | undefined;
        if (faultType === 'hallucination') {
          const p = resolveParams('hallucination', faultParams?.hallucination);
          systemPrompt = p.intensity === 'mild' ? MILD_ADVERSARIAL : AGGRESSIVE_ADVERSARIAL;
        }
        const res = await llmTurn(sttResult!.transcript || 'hello', {
          model: opts.config?.llmModel,
          systemPrompt,
        });
        llmText = res.text;
        llmMeta = { model: res.model, prompt_tokens: res.promptTokens, completion_tokens: res.completionTokens };
      } catch (e) {
        status = status === 'timeout' ? 'timeout' : 'error';
        exceptionType = (e as Error).name;
        const endedAtStage = new Date();
        await insertStage(callId, 'llm', 'openai', startedAtStage, endedAtStage, status, { error: (e as Error).message }, 0);
        stages.push({ stage: 'llm', durationMs: endedAtStage.getTime() - startedAtStage.getTime(), status, errorType: exceptionType });
        broadcast({ type: 'call.stage', callId, stage: 'llm', status });
        throw e;
      }
      const endedAtStage = new Date();
      const cost = costForStage({ stage: 'llm', provider: 'openai', rawMeta: llmMeta });
      totalCost += cost;
      await insertStage(callId, 'llm', 'openai', startedAtStage, endedAtStage, status, llmMeta, cost);
      stages.push({ stage: 'llm', durationMs: endedAtStage.getTime() - startedAtStage.getTime(), status });
      broadcast({ type: 'call.stage', callId, stage: 'llm', status });

      const shouldCheck = faultType === 'hallucination';
      if (shouldCheck && llmText.length > 40) {
        const hall = await detectHallucination(sttResult!.transcript, llmText);
        hallucinated = hall.hallucinated;
        totalCost += hall.auxCostUsd;
      }
    }

    // TTS
    {
      const startedAtStage = new Date();
      let status: 'ok' | 'error' | 'timeout' = 'ok';
      try {
        if (faultType === 'timeout') {
          const p = resolveParams('timeout', faultParams?.timeout);
          if (p.stage === 'tts') {
            await delay(SLA.tts + (p.extraDelayMs ?? 3000));
            status = 'timeout';
          }
        }
        throwForStage(faultType, faultParams, 'tts');
        if (faultType === 'network_drop' && resolveParams('network_drop', faultParams?.network_drop).stage === 'tts') networkDropSignaled = true;
        if (faultType === 'user_hangup' && resolveParams('user_hangup', faultParams?.user_hangup).stage === 'tts') hangupSignaled = true;

        let inputText = llmText;
        if (faultType === 'tts_glitch') {
          const p = resolveParams('tts_glitch', faultParams?.tts_glitch);
          inputText = truncateForTts(llmText, p.truncatePct, p.injectNulls);
        }
        ttsResult = await synthesize(inputText || '.');
      } catch (e) {
        status = status === 'timeout' ? 'timeout' : 'error';
        exceptionType = (e as Error).name;
        const endedAtStage = new Date();
        await insertStage(callId, 'tts', 'openai', startedAtStage, endedAtStage, status, { error: (e as Error).message }, 0);
        stages.push({ stage: 'tts', durationMs: endedAtStage.getTime() - startedAtStage.getTime(), status, errorType: exceptionType });
        broadcast({ type: 'call.stage', callId, stage: 'tts', status });
        throw e;
      }
      const endedAtStage = new Date();
      const cost = costForStage({ stage: 'tts', provider: 'openai', rawMeta: { model: ttsResult.model, charCount: ttsResult.charCount } });
      totalCost += cost;
      await insertStage(callId, 'tts', 'openai', startedAtStage, endedAtStage, status, {
        model: ttsResult.model, charCount: ttsResult.charCount, bytes: ttsResult.bytes,
      }, cost);
      stages.push({ stage: 'tts', durationMs: endedAtStage.getTime() - startedAtStage.getTime(), status });
      broadcast({ type: 'call.stage', callId, stage: 'tts', status });
      saveTtsAudio(callId, ttsResult.audio).catch(() => {});
    }
  } catch (err) {
    if (!(err instanceof InjectedError)) {
      exceptionType = exceptionType ?? (err as Error).name;
    }
  }

  const sttSignal = sttResult ? sttConfidenceSignal(sttResult) : { avgConfidence: 0, belowThreshold: false };
  const ttsMismatch = ttsDurationMismatch(ttsResult, llmText);

  const classification = classify({
    stages,
    hangupSignaled,
    networkDropSignaled,
    exceptionType,
    sttAvgConfidence: sttSignal.avgConfidence,
    sttThreshold: STT_CONFIDENCE_THRESHOLD,
    ttsDurationMismatch: ttsMismatch,
    hallucinationDetected: hallucinated,
    slaByStage: SLA,
  });

  const overallStatus = classification.category === 'ok' ? 'completed' : 'failed';
  const redacted = sttResult ? redactPII(sttResult.transcript) : '';

  await query(
    `UPDATE calls SET
       ended_at=$2, status=$3, stt_provider_used=$4, stt_failover_occurred=$5,
       predicted_category=$6, classifier_confidence=$7, redacted_transcript=$8, total_cost_usd=$9
     WHERE id=$1`,
    [callId, new Date(), overallStatus, sttResult?.provider ?? null, sttResult?.failoverOccurred ?? false,
     classification.category, classification.confidence, redacted, totalCost],
  );

  addSessionSpend(totalCost);
  broadcast({
    type: 'call.completed', callId, status: overallStatus, category: classification.category,
    faultType, totalCost, ttsAvailable: !!ttsResult,
  });

  if (overallStatus === 'failed') {
    generateAutopsyReport(callId).catch((e) => console.error('[autopsy]', e.message));
  }
  return { callId };
}

export { ALL_FAULTS };
