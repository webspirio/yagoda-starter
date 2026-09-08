export function Sparkline({
  values,
  color = 'var(--chart-1)',
  height = 40,
  className,
  /** false scales between min and max — right for prices, where the interesting range is narrow */
  zeroBased = true,
}: {
  values: number[];
  color?: string;
  height?: number;
  className?: string;
  zeroBased?: boolean;
}) {
  if (!values.length) return null;
  const w = 100;
  const hi = Math.max(...values);
  const lo = zeroBased ? 0 : Math.min(...values);
  const span = hi - lo || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map(
    (v, i) => [i * step, height - ((v - lo) / span) * (height - 5) - 2.5] as const,
  );
  const line = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${w},${height} L0,${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      className={className}
      style={{ width: '100%', height }}
      aria-hidden
    >
      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} stroke="var(--card)" strokeWidth={2} />
    </svg>
  );
}
