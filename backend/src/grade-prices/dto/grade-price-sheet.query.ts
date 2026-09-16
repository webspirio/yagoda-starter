/**
 * The SHEET read takes nothing — deliberately.
 *
 * It is scoped by the actor (`resolvePointFilter`), bounded by the active grade
 * and point counts, and unpaginated. There is no `collection_point_id`: a sheet
 * of ONE point is what the operator already gets for free, and an owner asking
 * for one column is asking for `/current`.
 *
 * The class exists rather than the route taking no `@Query()` at all, so that
 * the first real filter (a product, say, once the catalog outgrows one screen)
 * has an obvious home and arrives validated like every other query in this
 * module.
 */
export class GradePriceSheetQueryDto {}
