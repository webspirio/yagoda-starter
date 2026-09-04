import * as React from 'react';
import { animate, useMotionValue } from 'motion/react';
import { cn } from '@/shared/lib/cn';
import { reducedFade, useReducedMotionSafe } from '@/shared/lib/motion';

interface AnimatedNumberProps {
  value: number;
  /** Formats the tweened value for display; default: rounded integer. */
  format?: (value: number) => string;
  className?: string;
}

const defaultFormat = (value: number) => Math.round(value).toString();

/**
 * Price / seat counter that tweens between values («Разом: €54», «12/20»).
 * Under reduced motion it still ticks over the shared ~150ms cross-fade
 * duration rather than jump-cutting to the new value.
 */
export function AnimatedNumber({ value, format, className }: AnimatedNumberProps) {
  const reduced = useReducedMotionSafe();
  const fmt = format ?? defaultFormat;
  const motionValue = useMotionValue(value);
  // Raw tweened number lives in state; formatting happens at render time so a
  // format prop change never needs a resync effect.
  const [current, setCurrent] = React.useState(value);

  React.useEffect(() => {
    return motionValue.on('change', (latest) => setCurrent(latest));
  }, [motionValue]);

  React.useEffect(() => {
    const controls = animate(
      motionValue,
      value,
      reduced ? reducedFade : { duration: 0.35, ease: 'easeOut' },
    );
    return () => controls.stop();
  }, [value, reduced, motionValue]);

  return <span className={cn('tabular-nums', className)}>{fmt(current)}</span>;
}
