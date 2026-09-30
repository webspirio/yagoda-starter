import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import { attachAuthInterceptors, httpClient } from './shared/api';
import { sessionAuthHooks } from './entities/user';
import { reportError } from './shared/lib/error-reporting';
import { initI18n } from './shared/lib/i18n';
import './index.css';

attachAuthInterceptors(httpClient, sessionAuthHooks);
const i18nReady = initI18n();

window.addEventListener('unhandledrejection', (event) => {
  reportError(event.reason, { type: 'unhandledrejection' });
});

window.addEventListener('error', (event) => {
  reportError(event.error ?? new Error(event.message), {
    type: 'uncaughterror',
    filename: event.filename,
    lineno: event.lineno,
  });
});

// React 19 no longer re-throws render errors to window — report them via root options.
const root = ReactDOM.createRoot(document.getElementById('root')!, {
  onUncaughtError: (error, errorInfo) => {
    reportError(error, { type: 'reactUncaughtError', componentStack: errorInfo.componentStack });
  },
  onCaughtError: (error, errorInfo) => {
    reportError(error, { type: 'reactCaughtError', componentStack: errorInfo.componentStack });
  },
});

// A stored `en` renders only once English has arrived; if that fetch fails,
// the UI stays in Ukrainian rather than showing raw keys.
void i18nReady
  .catch((error: unknown) => reportError(error, { type: 'i18nLoad' }))
  .finally(() =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
