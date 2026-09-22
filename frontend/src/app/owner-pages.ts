/**
 * THE CONTENTS OF THE OWNER-ONLY CHUNK. Nothing imports this module
 * statically — `lazy-routes.ts` reaches it through a single `import()`, and
 * that one dynamic edge is what makes the bundler cut everything reachable
 * from here out of the entry chunk.
 *
 * Adding an owner-only screen? Re-export it here and wrap it in
 * `lazy-routes.ts`. Do NOT import this module anywhere else: a single static
 * import from the eager graph pulls all six screens straight back into the
 * entry chunk and silently undoes the split.
 */
export { PointsPage } from '@/pages/points';
export { UsersPage } from '@/pages/users';
export { CatalogPage } from '@/pages/catalog';
export { JournalPage } from '@/pages/journal';
export { TransfersPage } from '@/pages/transfers';
export { ReweighPage } from '@/pages/reweigh';
export { CostOfDayPage } from '@/pages/cost-of-day';
