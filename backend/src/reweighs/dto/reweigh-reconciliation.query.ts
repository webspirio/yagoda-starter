import { BooleanQueryParam } from '../../common/dto/boolean-query-param';

/**
 * `GET /shifts/:shiftId/reweigh`'s one flag. §8.7's storno leaves the row:
 * «документ НЕ зникає: лишається з позначкою "сторновано", часом, автором і
 * причиною» — without this, the line the owner just voided disappears from
 * `items[]` on the next refetch, taking its reason and author with it.
 *
 * Left `undefined` when the query string omits it, so `forShift`'s own
 * `includeVoided = false` default parameter supplies the fallback — this DTO
 * states no opinion of its own about the default, on purpose, because a
 * value that both an optional DTO field and its consumer defaulted would
 * make one of the two defaults dead code.
 */
export class ReweighReconciliationQueryDto {
  @BooleanQueryParam()
  include_voided?: boolean;
}
