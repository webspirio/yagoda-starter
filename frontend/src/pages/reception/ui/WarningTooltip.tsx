import { useState, type ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';

/**
 * A line editor's amber hint, said on the control it is about: the caller
 * paints the control amber, this shows the reason on hover (client, 24.10). A
 * hint that popped in as a line under the preview shifted the card while the
 * operator typed.
 *
 * Always mounted, and open only while there is a `text`: wrapping and
 * unwrapping the control as the hint comes and goes would remount the input
 * under the operator's fingers. A screen reader never hovers, so the caller
 * also links the same text to the control through `aria-describedby`.
 */
export function WarningTooltip({
  text,
  children,
}: {
  text: string | null;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip open={text !== null && open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-72 text-left font-normal">{text}</TooltipContent>
    </Tooltip>
  );
}
