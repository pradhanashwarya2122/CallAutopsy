interface Stage {
  stage: string;
  provider?: string | null;
  duration_ms: number;
  status: string;
  cost_usd?: number | null;
}

export function StageTimeline({ stages }: { stages: Stage[] }) {
  if (!stages.length) return <p className="text-sm text-neutral-500">No stages recorded.</p>;
  const max = Math.max(...stages.map((s) => s.duration_ms || 0), 1);

  return (
    <div className="space-y-2">
      {stages.map((s, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-14 font-mono text-xs uppercase text-neutral-600">{s.stage}</div>
          <div className="flex-1 h-6 bg-neutral-100 rounded-sm relative overflow-hidden">
            <div
              className={`h-full ${s.status === 'ok' ? 'bg-neutral-800' : 'bg-accent'} opacity-80`}
              style={{ width: `${(s.duration_ms / max) * 100}%` }}
            />
            <span className="absolute inset-0 flex items-center px-2 font-mono text-[10px] text-white mix-blend-difference">
              {s.duration_ms}ms · {s.provider ?? '-'} · {s.status}
            </span>
          </div>
          <div className="w-24 text-right font-mono text-xs text-neutral-700">
            ${Number(s.cost_usd ?? 0).toFixed(6)}
          </div>
        </div>
      ))}
    </div>
  );
}
