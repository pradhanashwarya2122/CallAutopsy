import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { Skeleton } from '../components/Skeleton';
import { PlayIcon } from '../components/Icons';

export function Replay() {
  const { id } = useParams();
  const [data, setData] = useState<any>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (id) api.getCall(id).then(setData);
  }, [id]);

  if (!data) return <Skeleton h={40} />;
  const stages = data.stages ?? [];
  const cur = stages[step];

  return (
    <div>
      <Link to={`/calls/${id}`} className="font-mono text-xs text-neutral-500 hover:text-neutral-900">
        ← Case file
      </Link>
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mt-4 mb-4">Replay</p>

      <section className="border border-neutral-200 bg-white rounded-sm p-4 mb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-2 flex items-center gap-2">
          <PlayIcon size={14} /> Input audio
        </p>
        <audio controls src={api.audioUrl(id!, 'input')} className="w-full" />
      </section>

      <div className="flex gap-2 mb-6 flex-wrap">
        {stages.map((s: any, i: number) => (
          <button
            key={s.id}
            onClick={() => setStep(i)}
            className={`px-3 py-1 text-xs rounded-sm border ${
              i === step ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-neutral-300 hover:bg-neutral-50'
            }`}
          >
            {i + 1}. {s.stage}
          </button>
        ))}
      </div>
      {cur && (
        <div className="border border-neutral-200 bg-white p-4 rounded-sm">
          <p className="font-mono text-xs text-neutral-500 mb-2">
            {cur.stage} · {cur.provider ?? '-'} · {cur.duration_ms}ms · {cur.status}
          </p>
          <pre className="text-xs bg-neutral-50 p-3 rounded-sm overflow-auto">
            {JSON.stringify(cur.raw_meta, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
