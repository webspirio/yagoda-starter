import { useEffect } from 'react';
import { useRouteError } from 'react-router';
import { ErrorFallback } from './ErrorFallback';
import { reportError } from '../../shared/lib/error-reporting';

/** Router errorElement — reports once per error identity, then shows the fallback. */
export function RouteError() {
  const error = useRouteError();
  useEffect(() => {
    reportError(error, { source: 'react-router' });
  }, [error]);
  return <ErrorFallback error={error} />;
}
