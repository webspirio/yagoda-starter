/**
 * §4.8 — a warehouse (`base`) is an ordinary reception point with its own,
 * higher price, which the "set for everyone" gesture does NOT touch.
 * §8.1 — re-weighing happens AT THE BASE, and the document distinguishes the
 * point the berries came FROM from the base they were weighed AT. Neither
 * statement is expressible without this column.
 */
export enum PointKind {
  Reception = 'reception',
  Base = 'base',
}
