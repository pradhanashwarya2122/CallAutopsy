import type { FaultType } from '../pipeline/faultInjection.js';

export type Category = FaultType | 'ok' | 'unknown';

export interface StageRecord {
  stage: 'stt' | 'llm' | 'tts';
  durationMs: number;
  status: 'ok' | 'error' | 'timeout';
  errorType?: string;
}

export interface ClassifyInput {
  stages: StageRecord[];
  hangupSignaled: boolean;
  networkDropSignaled: boolean;
  exceptionType?: string;
  sttAvgConfidence: number;
  sttThreshold: number;
  ttsDurationMismatch: boolean;
  hallucinationDetected: boolean;
  sttTranscriptEmpty?: boolean;
  slaByStage: { stt: number; llm: number; tts: number };
}

export interface Classification {
  category: Category;
  confidence: number;
  reasons: string[];
}

export function classify(input: ClassifyInput): Classification {
  const reasons: string[] = [];

  if (input.networkDropSignaled) {
    return { category: 'network_drop', confidence: 1, reasons: ['websocket close event received'] };
  }
  if (input.hangupSignaled) {
    return { category: 'user_hangup', confidence: 1, reasons: ['user cancellation signal received'] };
  }
  if (input.exceptionType) {
    return {
      category: 'exception',
      confidence: 0.95,
      reasons: [`unhandled ${input.exceptionType} caught`],
    };
  }

  for (const s of input.stages) {
    const sla = input.slaByStage[s.stage];
    if (s.status === 'timeout' || (sla && s.durationMs > sla)) {
      return {
        category: 'timeout',
        confidence: 0.95,
        reasons: [`stage ${s.stage} exceeded SLA (${s.durationMs}ms > ${sla}ms)`],
      };
    }
  }

  if (input.hallucinationDetected) {
    return { category: 'hallucination', confidence: 0.85, reasons: ['grounding check flagged response'] };
  }

  if (input.sttTranscriptEmpty) {
    return { category: 'bad_stt', confidence: 0.85, reasons: ['speech-to-text returned an empty transcript'] };
  }

  if (input.sttAvgConfidence > 0 && input.sttAvgConfidence < input.sttThreshold) {
    reasons.push(
      `avg STT confidence ${input.sttAvgConfidence.toFixed(2)} < threshold ${input.sttThreshold}`,
    );
    return { category: 'bad_stt', confidence: 0.9, reasons };
  }

  if (input.ttsDurationMismatch) {
    return { category: 'tts_glitch', confidence: 0.8, reasons: ['tts duration mismatch vs. expected'] };
  }

  return { category: 'ok', confidence: 0.9, reasons: ['no failure signals'] };
}
