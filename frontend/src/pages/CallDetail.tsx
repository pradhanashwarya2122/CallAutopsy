import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { CauseOfDeathTag } from '../components/CauseOfDeathTag';
import { StageTimeline } from '../components/StageTimeline';
import { Skeleton, TableSkeleton } from '../components/Skeleton';
import { PlayIcon, ClipboardIcon } from '../components/Icons';
import CallAnalysisPanels from '../components/CallAnalysis.jsx';

function StructuredReport({ text }: { text: string }) {
  const sections = text
    .split(/^##\s+/m)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [head, ...rest] = chunk.split('\n');
      return { heading: head.trim(), body: rest.join('\n').trim() };
    });
  if (sections.length < 2) {
    return <p className="text-sm leading-relaxed whitespace-pre-line">{text}</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {sections.map((s, i) => (
        <div key={i} className="border-l-2 border-neutral-300 pl-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-1">{s.heading}</p>
          <p className="text-sm leading-relaxed">{s.body}</p>
        </div>
      ))}
    </div>
  );
}

export function CallDetail() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  const [autoPlayed, setAutoPlayed] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      try {
        setData(await api.getCall(id));
        setMissing(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setMissing(true);
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [id]);

  useEffect(() => {
    if (!data || autoPlayed) return;
    const done = data.call?.status === 'completed' || data.call?.status === 'failed';
    const hasTts = data.stages?.some((s: any) => s.stage === 'tts' && s.status === 'ok');
    if (done && hasTts && audioRef.current) {
      audioRef.current.play().catch(() => {});
      setAutoPlayed(true);
    }
  }, [data, autoPlayed]);

  if (missing && !data)
    return (
      <div>
        <Link to="/app" className="font-mono text-xs text-neutral-500 hover:text-neutral-900">← Dashboard</Link>
        <p className="mt-6 text-sm">Case not found. It may belong to a different workspace, or it no longer exists.</p>
      </div>
    );

  if (!data)
    return (
      <div className="space-y-4">
        <Skeleton h={18} w={280} />
        <Skeleton h={14} w={200} />
        <TableSkeleton rows={4} />
      </div>
    );

  const { call, stages, autopsy } = data;
  const hasTts = stages?.some((s: any) => s.stage === 'tts' && s.status === 'ok');

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <Link to="/app" className="font-mono text-xs text-neutral-500 hover:text-neutral-900">
          ← Dashboard
        </Link>
        <Link
          to={`/calls/${call.id}/replay`}
          className="font-mono text-xs text-neutral-500 hover:text-neutral-900"
        >
          Replay →
        </Link>
      </div>
      <div className="mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 flex items-center gap-2">
          <ClipboardIcon size={14} /> Case file
        </p>
        <p className="font-mono text-xs mt-1">{call.id}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <CauseOfDeathTag category={call.predicted_category} />
          <span className="font-mono text-xs text-neutral-500">
            confidence {Number(call.classifier_confidence ?? 0).toFixed(2)}
          </span>
          {call.injected_fault && (
            <span className="font-mono text-xs text-neutral-500">
              ground truth: {call.injected_fault}
            </span>
          )}
          <a
            href={api.pdfUrl(call.id)}
            className="ml-auto text-xs px-3 py-1 border border-neutral-300 rounded-sm hover:bg-neutral-50"
          >
            Export PDF
          </a>
        </div>
      </div>

      {call.analysis && (
        <div className="ap-root ap-embed mb-6">
          <CallAnalysisPanels analysis={call.analysis} />
        </div>
      )}

      {hasTts && (
        <section className="border border-neutral-200 bg-white rounded-sm p-4 mb-6">
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-2 flex items-center gap-2">
            <PlayIcon size={14} /> Synthesized reply
          </p>
          <audio ref={audioRef} controls src={api.audioUrl(call.id, 'tts')} className="w-full" />
        </section>
      )}

      <section className="border border-neutral-200 bg-white rounded-sm p-4 mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3">
          Stage timeline
        </p>
        <StageTimeline stages={stages} />
        <div className="mt-4 flex justify-between text-xs font-mono text-neutral-600">
          <span>
            STT: {call.stt_provider_used ?? '-'}
            {call.stt_failover_occurred ? ' (failover)' : ''}
          </span>
          <span>total: ${Number(call.total_cost_usd ?? 0).toFixed(6)}</span>
        </div>
      </section>

      {call.redacted_transcript && (
        <section className="border border-neutral-200 bg-white rounded-sm p-4 mb-6">
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-2">
            Transcript (redacted)
          </p>
          <p className="text-sm">{call.redacted_transcript}</p>
        </section>
      )}

      {autopsy && (
        <section className="border border-neutral-200 bg-white rounded-sm p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3">
            Postmortem
          </p>
          <StructuredReport text={autopsy.report_text} />
        </section>
      )}
    </div>
  );
}
