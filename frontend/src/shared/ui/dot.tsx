import { cn } from '@/shared/lib/cn';

export function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', className)}
      style={{ background: color }}
    />
  );
}
