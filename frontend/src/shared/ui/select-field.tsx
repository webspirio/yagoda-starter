import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { fieldBaseClass } from './field';

/** Native <select> styled to the prototype `.fld`, with a custom chevron. */
export const SelectField = React.forwardRef<HTMLSelectElement, React.ComponentProps<'select'>>(
  function SelectField({ className, children, ...props }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          className={cn(fieldBaseClass, 'h-[46px] cursor-pointer appearance-none pr-9', className)}
          {...props}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>
    );
  },
);
