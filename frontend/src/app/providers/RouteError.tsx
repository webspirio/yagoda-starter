import { useEffect } from 'react';
import { useRouteError } from 'react-router';
import { ErrorFallback } from './ErrorFallback';
import { reportError } from '../../shared/lib/error-reporting';

interface Props {
  /** Forwarded to {@link ErrorFallback} — see its doc for what `false` swaps. */
  fullHeight?: boolean;
}

/** Router errorElement — reports once per error identity, then shows the fallback. */
export function RouteError({ fullHeight = true }: Props) {
  const error = useRouteError();
  useEffect(() => {
    reportError(error, { source: 'react-router' });
  }, [error]);
  return <ErrorFallback error={error} fullHeight={fullHeight} />;
}
