import * as React from 'react';

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="font-medium">{title}</div>
      {hint ? <div className="max-w-sm text-sm text-muted-foreground">{hint}</div> : null}
      {action}
    </div>
  );
}
