import type { ComponentProps, ReactNode } from 'react';
import { TraceTerm } from '@/shared/ui/trace';

type TermProps = Omit<ComponentProps<typeof TraceTerm>, 'children'> & { children?: ReactNode };

/**
 * `TraceTerm` as a `<Trans>` component: there the translation supplies the
 * figure (`<accrued>{{accrued}}</accrued>`), so `children` is optional.
 */
export function Term({ children, ...props }: TermProps) {
  return <TraceTerm {...props}>{children}</TraceTerm>;
}

/**
 * A недостача operand. Amber is the недостача's colour and nothing else's, and
 * the screens' tests hold every amber mark to a `data-group="shortfall"` band —
 * so an amber figure inside an otherwise neutral formula carries the band with it.
 */
export function ShortfallTerm({ children, ...props }: Omit<TermProps, 'tone'>) {
  return (
    <span data-group="shortfall">
      <TraceTerm {...props} tone="amber">
        {children}
      </TraceTerm>
    </span>
  );
}
