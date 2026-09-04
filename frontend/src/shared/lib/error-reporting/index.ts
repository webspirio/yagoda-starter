export type ErrorContext = Record<string, unknown>;

export function reportError(error: unknown, context?: ErrorContext): void {
  // When Sentry is added: replace this body with Sentry.captureException(error, { extra: context })
  console.error('[error-reporting]', error, context ?? '');
}
