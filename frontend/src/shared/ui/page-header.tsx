import * as React from 'react';
import { Eyebrow } from './eyebrow';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow> : null}
        <h1 className="font-display text-2xl leading-tight font-medium">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
