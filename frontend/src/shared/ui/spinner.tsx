import { Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 24, className }: SpinnerProps) {
  return (
    <Loader2
      role="progressbar"
      aria-label="loading"
      size={size}
      className={cn('animate-spin text-brand', className)}
    />
  );
}
