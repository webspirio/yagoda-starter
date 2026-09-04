import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';

interface Props {
  error: unknown;
  /** Clears the boundary state and re-renders children without a full page reload. */
  onReset?: () => void;
  onReload?: () => void;
}

export function ErrorFallback({ error, onReset, onReload }: Props) {
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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-medium">{t('errorFallback.title')}</h1>
      <p className="text-center text-sm text-muted-foreground">{t('errorFallback.body')}</p>
      {onReset && <Button onClick={onReset}>{t('errorFallback.tryAgain')}</Button>}
      <Button variant={onReset ? 'outline' : 'default'} onClick={reload}>
        {t('errorFallback.reload')}
      </Button>
    </div>
  );
}
