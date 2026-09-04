import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PersistedClient } from '@tanstack/react-query-persist-client';
import {
  isPersistableKey,
  buildPersistOptions,
  safeStorage,
  createCachePersister,
  hashToken,
  PERSIST_VERSION,
} from './persister';

describe('isPersistableKey', () => {
  it('allows the signed-in user profile key', () => {
    expect(isPersistableKey(['me'])).toBe(true);
  });

  it('denies anything else', () => {
    expect(isPersistableKey(['other'])).toBe(false);
    expect(isPersistableKey([])).toBe(false);
  });
});

describe('buildPersistOptions', () => {
  // Asserts the SCOPING, not the version number: the buster must vary per
  // identity so one account's cache can never rehydrate under another. Written
  // against PERSIST_VERSION rather than a literal so a deliberate bump does not
  // read as a regression here — what a bump must not do is silently drop the
  // `:<identity>` suffix, which is exactly what this still catches.
  it('scopes the buster to a fingerprint of the identity, keeping anon literal', () => {
    expect(buildPersistOptions('some-token').buster).toBe(
      `v${PERSIST_VERSION}:${hashToken('some-token')}`,
    );
    expect(buildPersistOptions('anon').buster).toBe(`v${PERSIST_VERSION}:anon`);
    expect(buildPersistOptions('some-token').buster).not.toBe(buildPersistOptions('anon').buster);
  });

  // Regression guard for the security fix: the raw bearer token must never
  // sit in the persisted blob. TanStack's sync-storage persister writes
  // `{ buster, ... }` to localStorage verbatim, so if `buildPersistOptions`
  // ever went back to using the token as-is, this is what would catch it.
  it('never embeds the raw token in the buster', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.super-secret-session-token.sig';
    expect(buildPersistOptions(token).buster).not.toContain(token);
  });

  // The other half of the regression guard: a hash that collapsed every
  // token to the same value would also pass the assertion above while
  // silently breaking cross-account cache isolation.
  it('scopes different tokens to different busters', () => {
    expect(buildPersistOptions('token-a').buster).not.toBe(buildPersistOptions('token-b').buster);
  });

  it('persists only successful allowlisted queries', () => {
    const should = buildPersistOptions('42').dehydrateOptions?.shouldDehydrateQuery;
    const q = (status: string, queryKey: readonly unknown[]) =>
      ({ state: { status }, queryKey }) as unknown as Parameters<NonNullable<typeof should>>[0];
    expect(should?.(q('success', ['me']))).toBe(true);
    expect(should?.(q('success', ['other']))).toBe(false);
    expect(should?.(q('pending', ['me']))).toBe(false);
  });
});

describe('safeStorage', () => {
  it('returns undefined when reading the storage throws (storage disabled)', () => {
    expect(
      safeStorage(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      }),
    ).toBeUndefined();
  });

  it('returns undefined when the storage exists but refuses writes', () => {
    const refusing = {
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    } as unknown as Storage;

    expect(safeStorage(() => refusing)).toBeUndefined();
  });

  it('returns the storage when it is usable, leaving no probe key behind', () => {
    expect(safeStorage(() => window.localStorage)).toBe(window.localStorage);
    expect(window.localStorage.length).toBe(0);
  });
});

/** A Storage stub that rejects any payload carrying more than `maxQueries`. */
function quotaBoundStorage(maxQueries: number) {
  let saved: string | null = null;
  const storage = {
    getItem: () => saved,
    setItem: (_key: string, value: string) => {
      const client = JSON.parse(value) as PersistedClient;
      if (client.clientState.queries.length > maxQueries) {
        throw new DOMException('exceeded the quota', 'QuotaExceededError');
      }
      saved = value;
    },
    removeItem: () => {
      saved = null;
    },
  } as unknown as Storage;
  return { storage, read: () => (saved ? (JSON.parse(saved) as PersistedClient) : null) };
}

const query = (key: string, dataUpdatedAt: number) =>
  ({ queryKey: [key], queryHash: `["${key}"]`, state: { data: null, dataUpdatedAt } }) as unknown as
    PersistedClient['clientState']['queries'][number];

describe('createCachePersister', () => {
  afterEach(() => vi.useRealTimers());

  it('drops the oldest query and retries instead of silently failing on quota overflow', () => {
    vi.useFakeTimers();
    const { storage, read } = quotaBoundStorage(1);
    const persister = createCachePersister(storage);

    void persister.persistClient({
      timestamp: 0,
      buster: 'v1:42',
      clientState: { mutations: [], queries: [query('old', 1_000), query('fresh', 2_000)] },
    } as PersistedClient);
    vi.advanceTimersByTime(1_000);

    expect(read()?.clientState.queries.map((q) => q.queryKey)).toEqual([['fresh']]);
  });

  it('degrades to a no-op persister when there is no usable storage', async () => {
    const persister = createCachePersister(undefined);

    expect(persister.persistClient({} as PersistedClient)).toBeUndefined();
    expect(await persister.restoreClient()).toBeUndefined();
  });
});
