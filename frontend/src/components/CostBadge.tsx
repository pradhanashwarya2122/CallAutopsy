export function CostBadge({ usd }: { usd: number | null | undefined }) {
  const v = Number(usd ?? 0);
  return (
    <span className="font-mono text-xs text-neutral-700">
      ${v.toFixed(6)}
    </span>
  );
}

export default CostBadge;
