import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { debounce } from '@/shared/lib/debounce';
import { loadLocal, writeLocal, removeLocal } from './draftStorage';

/** The single persisted shape. */
interface DraftEnvelope<TValues, TMeta> {
  v: number;
  updatedAt: number;
  values: Partial<TValues>;
  meta?: TMeta;
}

export interface UseFormDraftOptions<TValues extends FieldValues, TMeta = undefined> {
  methods: UseFormReturn<TValues>;
  /** Resolved storage key (caller owns namespacing). */
  storageKey: string;
  /** Schema version — a mismatch discards the blob (no migration). */
  version: number;
  /** Value keys never persisted (e.g. a non-serializable File). */
  exclude?: readonly (keyof TValues)[];
  /** Caller metadata persisted alongside the values (e.g. wizard step / draft photo url). */
  meta?: TMeta;
  /** Called with the restored meta after `methods.reset`. */
  onRestore?: (meta: TMeta | undefined) => void;
  /** Return true to discard a draft (e.g. the underlying entity changed server-side). */
  isStale?: (meta: TMeta | undefined, updatedAt: number) => boolean;
  /** Optional TTL; omitted = no age limit. */
  maxAgeMs?: number;
}

// ---- pure helpers (kept out of the component so the purity rule is satisfied) ----

function keepValues<TValues extends FieldValues>(
  values: TValues,
  exclude?: readonly (keyof TValues)[],
): Partial<TValues> {
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(values) as (keyof TValues)[]) {
    if (exclude?.includes(key)) continue;
    kept[key as string] = (values as Record<string, unknown>)[key as string];
  }
  return kept as Partial<TValues>;
}

/** The change-detection payload (values + meta, no timestamp) — restore echoes and identical saves skip. */
function payloadOf<TValues extends FieldValues, TMeta>(
  values: TValues,
  meta: TMeta | undefined,
  exclude?: readonly (keyof TValues)[],
): string {
  return JSON.stringify({ values: keepValues(values, exclude), meta });
}

function parseEnvelope<TValues extends FieldValues, TMeta>(
  raw: string | null,
  version: number,
): { values: Partial<TValues>; meta: TMeta | undefined; updatedAt: number } | null {
  if (!raw) return null;
  let env: Partial<DraftEnvelope<TValues, TMeta>>;
  try {
    env = JSON.parse(raw) as Partial<DraftEnvelope<TValues, TMeta>>;
  } catch {
    return null;
  }
  if (!env || env.v !== version || typeof env.values !== 'object' || env.values === null) return null;
  return {
    values: env.values,
    meta: env.meta,
    updatedAt: typeof env.updatedAt === 'number' ? env.updatedAt : 0,
  };
}

/**
 * Generic durable draft for a react-hook-form, backed by localStorage. A
 * restore never echoes a redundant save; `clearDraft` removes the stored
 * draft.
 */
export function useFormDraft<TValues extends FieldValues, TMeta = undefined>({
  methods,
  storageKey,
  version,
  exclude,
  meta,
  onRestore,
  isStale,
  maxAgeMs,
}: UseFormDraftOptions<TValues, TMeta>): { clearDraft: () => void } {
  // Latest option values for the debounced save, synced in an effect (never
  // written during render — the React Compiler purity rule).
  const latest = useRef({ meta, onRestore, isStale, maxAgeMs, exclude, version });
  useLayoutEffect(() => {
    latest.current = { meta, onRestore, isStale, maxAgeMs, exclude, version };
  });

  // What we last restored/saved — persist dedups against it, and it stays
  // null on a fresh form so the initial state IS persisted on mount
  // (capturing e.g. a prefill, matching the pre-generic behaviour).
  const lastPayloadRef = useRef<string | null>(null);
  const debouncedRef = useRef<(((v: TValues) => void) & { cancel: () => void }) | null>(null);

  // Sync restore on mount. Re-runs only when the key changes.
  useLayoutEffect(() => {
    const opts = latest.current;
    const now = Date.now();
    const fresh = (u: number) => opts.maxAgeMs == null || u === 0 || now - u <= opts.maxAgeMs;

    const localRaw = loadLocal(storageKey);
    const local = parseEnvelope<TValues, TMeta>(localRaw, opts.version);
    if (local && fresh(local.updatedAt) && !opts.isStale?.(local.meta, local.updatedAt)) {
      const merged = { ...methods.getValues() } as TValues;
      for (const key of Object.keys(local.values) as (keyof TValues)[]) {
        if (opts.exclude?.includes(key)) continue;
        (merged as Record<string, unknown>)[key as string] = (local.values as Record<string, unknown>)[
          key as string
        ];
      }
      lastPayloadRef.current = payloadOf(merged, local.meta, opts.exclude);
      methods.reset(merged);
      opts.onRestore?.(local.meta);
    } else if (localRaw != null) {
      // Corrupt / wrong version / expired / stale (e.g. the entity changed
      // server-side) — sweep the stored copy so it can't be restored later.
      removeLocal(storageKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Debounced persist (created in an effect so `Date.now()` is legitimately
  // impure), skipping an unchanged payload — this is what makes the reset()->
  // watch() echo after a restore a no-op and dedupes identical saves.
  useEffect(() => {
    const d = debounce((values: TValues) => {
      const opts = latest.current;
      const kept = keepValues(values, opts.exclude);
      const payload = JSON.stringify({ values: kept, meta: opts.meta });
      if (payload === lastPayloadRef.current) return;
      lastPayloadRef.current = payload;
      const env: DraftEnvelope<TValues, TMeta> = {
        v: opts.version,
        updatedAt: Date.now(),
        values: kept,
        meta: opts.meta,
      };
      writeLocal(storageKey, JSON.stringify(env));
    }, 400);
    debouncedRef.current = d;
    const sub = methods.watch((values) => d(values as TValues));
    return () => {
      sub.unsubscribe();
      d.cancel();
      debouncedRef.current = null;
    };
  }, [methods, storageKey]);

  // A bare `meta` change (e.g. wizard step) must persist too — `watch` only
  // fires on field edits.
  useEffect(() => {
    debouncedRef.current?.(methods.getValues());
  }, [meta, methods]);

  const clearDraft = useCallback(() => {
    debouncedRef.current?.cancel();
    removeLocal(storageKey);
  }, [storageKey]);

  return { clearDraft };
}
