import { lazy } from 'react';

/*
 * THE OWNER-ONLY GROUP, CUT OUT OF THE ENTRY CHUNK.
 *
 * WHY. Every screen here is behind `RequireRole role="network_owner"` in
 * `router.tsx`, so an operator can never reach one — and until this split
 * every operator downloaded all six anyway: six management screens that a
 * phone at a collection point, on mobile data, fetches, parses and compiles
 * on first paint and then never runs. Measured on this branch, the operator's
 * first load went from 309,842 B gzip / 1,089,334 B raw to 291,949 /
 * 1,007,840 — 17.9 KiB gzip and 79.6 KiB raw they no longer pay.
 *
 * WHY ONE CHUNK FOR ALL SIX, and not one per page. Both were built and
 * measured. Six separate `import()` entry points made the bundler hoist the
 * code shared between them and the eager graph into SEVEN extra chunks
 * (`table`, `url-state`, `dialog`, `tare-type`, `api-error`,
 * `void-document`, `collection-point`) — every one of them `modulepreload`ed
 * from index.html, so the operator's first load became TEN requests instead
 * of two and, because each file is compressed on its own, 297,437 B gzip
 * rather than 291,949. One dynamic entry point produces no shared chunks at
 * all: the operator gets one JS file and one CSS file, strictly fewer bytes
 * AND strictly fewer round trips. The owner pays 20.4 KiB gzip once, the
 * first time they open any management screen, instead of 2.4-5.7 KiB per
 * screen — a trade taken at a desk, not in a field.
 *
 * THE GUARD MUST STAY OUTSIDE THE LAZY COMPONENT, and that ordering lives in
 * `router.tsx`: `<RequireRole><ReweighPage /></RequireRole>`, never the other
 * way round. `children` there is a React element — constructed, not rendered
 * — and `React.lazy` calls its factory only when the element is actually
 * rendered, so an operator is redirected before the request goes out. Invert
 * the two and code-splitting becomes authorisation-by-download: the chunk
 * arrives, and only then is the user told they may not have it.
 * `router.lazy-guard.test.tsx` holds that property down.
 *
 * `.then(m => ({ default: … }))` is the adapter for this repo's named-export
 * page barrels; `React.lazy` wants a module whose `default` is the component.
 *
 * ADDING A ROUTE? If it is owner-only, re-export it from `./owner-pages`, add
 * a line here, and wrap it in `RequireAuth` + `RequireRole` in `router.tsx`.
 * The Suspense boundary it needs already exists — AppLayout's main column,
 * one for the whole app — so there is nothing else to wire. If it is a screen
 * an operator opens every shift, import it eagerly in `router.tsx` instead: a
 * chunk is a round trip, and spending one on the daily path to defer bytes
 * the daily path needs anyway is the wrong trade.
 */
const ownerPages = () => import('./owner-pages');

export const PointsPage = lazy(() => ownerPages().then((m) => ({ default: m.PointsPage })));
export const UsersPage = lazy(() => ownerPages().then((m) => ({ default: m.UsersPage })));
export const CatalogPage = lazy(() => ownerPages().then((m) => ({ default: m.CatalogPage })));
export const JournalPage = lazy(() => ownerPages().then((m) => ({ default: m.JournalPage })));
export const TransfersPage = lazy(() => ownerPages().then((m) => ({ default: m.TransfersPage })));
export const ReweighPage = lazy(() => ownerPages().then((m) => ({ default: m.ReweighPage })));
