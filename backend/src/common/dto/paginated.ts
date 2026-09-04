/** Response envelope paired with PaginationQueryDto — see that file's doc comment. */
export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
