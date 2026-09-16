/**
 * The last collection point the owner worked on, remembered between screens.
 *
 * WHY THIS EXISTS. The point lives in `?point=` so a reload or a shared link
 * lands on the same place — but every screen has its own URL, so walking from
 * «Каса за день» to «Прийомка» dropped the choice and the owner picked the
 * same point again on every screen. The URL stays the source of truth when it
 * carries one; this is only the memory for when it does not.
 *
 * INFRASTRUCTURE, NOT A DOMAIN RULE — it stores an opaque id and knows nothing
 * about points, roles or which one is the warehouse. That belongs a layer up
 * (see `features/point-scope`), which is why this file can live in `shared`.
 *
 * Modelled on `shared/lib/i18n/language-preference.ts`, down to swallowing
 * every storage error: a private window or blocked site data must degrade to
 * «nothing remembered», never to a crash on a money screen.
 */
const KEY = 'web-starter:point';

/** The same shape `collection_point_id` is validated as server-side. A
 *  hand-edited or stale value must not reach the API as-is. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getStoredPoint(): string | null {
  try {
    const value = localStorage.getItem(KEY);
    return value && UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** `null` forgets the point — what «Усі точки» means for a screen that offers it. */
export function storePoint(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(KEY);
    else if (UUID.test(id)) localStorage.setItem(KEY, id);
  } catch {
    /* storage disabled — ignore */
  }
}
