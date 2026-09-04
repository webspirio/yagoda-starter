import * as React from 'react';
import { cn } from '@/shared/lib/cn';
import { fieldBaseClass } from './field';

/** Multiline input styled to the prototype `.fld` textarea variant. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  function Textarea({ className, rows = 3, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(fieldBaseClass, 'min-h-20 resize-none py-3 leading-normal', className)}
        {...props}
      />
    );
  },
);
