/** «Бондар Тарас», or «—» when nobody is known. */
export function staffName(
  p: { first_name: string; last_name: string } | null | undefined,
): string {
  return p ? `${p.last_name} ${p.first_name}` : '—';
}
