interface Props {
  h?: number;
  w?: number | string;
  className?: string;
}

export function Skeleton({ h, w, className = '' }: Props) {
  const styleObj = h || w ? {
    height: h ? `${h}px` : undefined,
    width: typeof w === 'number' ? `${w}px` : (w as string | undefined),
  } : undefined;
  return (
    <span
      className={`block animate-pulse bg-neutral-200 rounded-sm ${className}`}
      style={styleObj}
    />
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} h={14} w={c === 0 ? 200 : 80} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default Skeleton;
