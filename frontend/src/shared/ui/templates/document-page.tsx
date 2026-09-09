import * as React from 'react';
import { Printer } from 'lucide-react';

import { cn } from '@/shared/lib/cn';
import { PageHeader } from '@/shared/ui/page-header';
import { Button } from '@/shared/ui/button';

export interface DocumentPageProps {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** rendered in a .print-only block (paper only) */
  printHeader?: React.ReactNode;
  /** on-sheet meta row (screen + paper) */
  meta?: React.ReactNode;
  /** document body */
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** default true — wraps body in .printable */
  printable?: boolean;
  /** adds .print-landscape */
  landscape?: boolean;
  /** default window.print() */
  onPrint?: () => void;
  maxWidth?: number | string;
  className?: string;
}

/**
 * Домен-незалежний шаблон друкованого документа. Малює шапку з кнопкою «Друк»,
 * що завжди додається до дій, і «аркуш» із тілом документа. Класи `.printable`,
 * `.print-only` і `.print-landscape` живуть у index.css — тут вони лише
 * застосовуються.
 */
export function DocumentPage({
  eyebrow,
  title,
  description,
  actions,
  printHeader,
  meta,
  children,
  footer,
  printable,
  landscape,
  onPrint,
  maxWidth,
  className,
}: DocumentPageProps): React.JSX.Element {
  const headerActions = (
    <>
      {actions}
      <Button variant="outline" size="sm" onClick={onPrint ?? (() => window.print())}>
        <Printer />
        Друк
      </Button>
    </>
  );

  const body = (
    <>
      {printHeader ? <div className="print-only">{printHeader}</div> : null}
      {meta ? <div className="mb-4">{meta}</div> : null}
      {children}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </>
  );

  return (
    <div className={cn('mx-auto w-full', className)} style={{ maxWidth: maxWidth ?? 900 }}>
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={headerActions}
      />
      {printable !== false ? (
        <div
          className={cn(
            'printable rounded-xl bg-card p-5 ring-1 ring-foreground/10 print:ring-0',
            landscape && 'print-landscape',
          )}
        >
          {body}
        </div>
      ) : (
        <div>{body}</div>
      )}
    </div>
  );
}
