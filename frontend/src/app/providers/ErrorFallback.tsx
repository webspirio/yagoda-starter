import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/cn';

interface Props {
  error: unknown;
  /** Clears the boundary state and re-renders children without a full page reload. */
  onReset?: () => void;
  onReload?: () => void;
  /**
   * `true` (default) sizes the production fallback for a WHOLE page (`min-h-dvh`) — the
   * top-level `AppLayout`/`/ui-kit` `errorElement`s, where the fallback IS the page. `false`
   * sizes it for a PANE instead (`min-h-[50vh]`) — the owner-only group's `errorElement`,
   * which renders INSIDE `AppLayout`'s `<main>` alongside a sidebar that survives the error
   * (see router.tsx's group comment); `min-h-dvh` there would push the pane taller than the
   * viewport for no reason, forcing a scroll past content that isn't there. The DEV branch
   * below (the raw stack trace) carries no `min-h-*` class either way — it's a block of
   * pre-formatted text, not a centred hero — so this prop has nothing to swap there.
   */
  fullHeight?: boolean;
}

export function ErrorFallback({ error, onReset, onReload, fullHeight = true }: Props) {
  const { t } = useTranslation();
  const reload = onReload ?? (() => window.location.reload());

  if (import.meta.env.DEV) {
    const message = error instanceof Error ? (error.stack ?? String(error)) : String(error);
    return (
      <div className="whitespace-pre-wrap break-all p-6 font-mono text-xs">
        <h2 className="mb-2 text-lg font-medium text-destructive">Unhandled error</h2>
        <pre className="mb-4 text-destructive">{message}</pre>
        <div className="flex flex-row gap-2">
          {onReset && (
            <Button size="sm" onClick={onReset}>
              {t('errorFallback.tryAgain')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={reload}>
            {t('errorFallback.reload')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 p-6',
        fullHeight ? 'min-h-dvh' : 'min-h-[50vh]',
      )}
    >
      <h1 className="text-lg font-medium">{t('errorFallback.title')}</h1>
      <p className="text-center text-sm text-muted-foreground">{t('errorFallback.body')}</p>
      {onReset && <Button onClick={onReset}>{t('errorFallback.tryAgain')}</Button>}
      <Button variant={onReset ? 'outline' : 'default'} onClick={reload}>
        {t('errorFallback.reload')}
      </Button>
    </div>
  );
}
