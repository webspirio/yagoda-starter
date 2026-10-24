/**
 * Two letters for an avatar: the first and the LAST word of a name — «Олена Петрівна
 * Коваль» → «ОК», «Alice Operator» → «AO» — not the first two letters of the string
 * («AL»), which read as a different person (audit 2026-10-24, F11). One word gives one
 * letter; an empty name gives «?».
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : '';
  return `${first.charAt(0)}${last.charAt(0)}`.toLocaleUpperCase();
}
