import '@fontsource-variable/onest';
import '@fontsource-variable/unbounded';
import '@fontsource-variable/jetbrains-mono';
import { useMemo } from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { RouterProvider } from 'react-router';
import { ErrorBoundary } from './providers';
import { queryClient, buildPersistOptions } from '@/shared/api';
import { useSession } from '@/entities/user';
import { router } from './router';

export function App() {
  const token = useSession((s) => s.token);
  // There is no synchronously-known user id at bootstrap — the `me` query
  // that would supply one is itself the thing being restored from the
  // persisted cache, so it can't gate the buster used to restore it. The
  // token is available synchronously (mirrored into localStorage by the
  // session store) and changes on every sign-in/out, so it is scope enough
  // to stop one account's cache from rehydrating under another. (It is
  // fingerprinted, not used raw, before it ever reaches the persisted blob
  // — see `buildPersistOptions` in `shared/api/persister.ts`.)
  const persistOptions = useMemo(() => buildPersistOptions(token ?? 'anon'), [token]);

  return (
    <ErrorBoundary>
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
        <RouterProvider router={router} />
      </PersistQueryClientProvider>
    </ErrorBoundary>
  );
}
