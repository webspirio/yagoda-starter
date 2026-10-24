import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { fieldBaseClass } from './field';

/**
 * Classes that size or place the BOX — they belong on the wrapper, which is what the
 * chevron is positioned against. Left on the select, `w-44` shrank the select inside a
 * full-width wrapper and the chevron floated off to the right (audit 2026-10-24, F3).
 * Variants (`sm:w-48`) travel with their class.
 */
const BOX_CLASS =
  /^(?:[a-z0-9[\]=&_-]+:)*-?(?:w-|min-w-|max-w-|flex-|basis-|grow|shrink|self-|justify-self-|col-|row-|order-|m[trblxyse]?-)/;

function splitBoxClasses(className: string | undefined): [box: string, own: string] {
  if (!className) return ['', ''];
  const box: string[] = [];
  const own: string[] = [];
  for (const token of className.split(/\s+/)) {
    if (!token) continue;
    (BOX_CLASS.test(token) ? box : own).push(token);
  }
  return [box.join(' '), own.join(' ')];
}

/** Native <select> styled to the prototype `.fld`, with a custom chevron. A width or
 *  margin in `className` goes to the wrapper; `wrapperClassName` targets it directly. */
export const SelectField = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<'select'> & { wrapperClassName?: string }
>(function SelectField({ className, wrapperClassName, children, ...props }, ref) {
  const [box, own] = splitBoxClasses(className);
  return (
    <div data-slot="select-field" className={cn('relative', box, wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          fieldBaseClass,
          'h-11.5 cursor-pointer appearance-none pr-9',
          own,
          // Last: the select always fills its wrapper, whatever `own` carried.
          'w-full max-w-none',
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
});
