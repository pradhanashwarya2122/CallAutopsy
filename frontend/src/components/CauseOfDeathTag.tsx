interface Props {
  category?: string | null;
  cause?: string | null;
}

const LABEL: Record<string, string> = {
  ok: 'HEALTHY',
  bad_stt: 'BAD STT',
  hallucination: 'HALLUCINATION',
  tts_glitch: 'TTS GLITCH',
  timeout: 'TIMEOUT',
  user_hangup: 'USER HANGUP',
  network_drop: 'NETWORK DROP',
  exception: 'EXCEPTION',
};

export function CauseOfDeathTag({ category, cause }: Props) {
  const c = cause ?? category ?? 'unknown';
  const isOk = c === 'ok';
  return (
    <span
      className={`inline-block px-2 py-0.5 font-mono text-[10px] tracking-wider uppercase rounded-sm border ${
        isOk
          ? 'border-green-700 text-green-800 bg-green-50'
          : 'border-accent text-accent bg-red-50'
      }`}
    >
      {LABEL[c] ?? c}
    </span>
  );
}

export default CauseOfDeathTag;
