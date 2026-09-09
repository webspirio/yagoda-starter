import { cn } from '@/shared/lib/cn';

/** Small horizontal proportion bar with a 2px gap between fills. */
export function ShareBar({
  parts,
  className,
}: {
  parts: { value: number; color: string; label: string }[];
  className?: string;
}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className={cn('flex h-2 w-full gap-[2px] overflow-hidden', className)}>
      {parts.map((p, i) => (
        <div
          key={i}
          title={p.label}
          className="h-full rounded-[2px] first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
        />
      ))}
    </div>
  );
}
