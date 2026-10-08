import { NOTE_LINE_CHARS, NOTE_LINES } from '@/entities/network-settings';

/**
 * Lays typed text onto the ruled lines: a line past the limit breaks at its
 * last space, or at the limit when one word fills it. Returns `null` when the
 * text needs more than `NOTE_LINES` lines — the form then keeps what it had.
 */
export function fitReceiptNote(text: string): string | null {
  const lines: string[] = [];
  for (let rest of text.split('\n')) {
    while (rest.length > NOTE_LINE_CHARS) {
      const space = rest.lastIndexOf(' ', NOTE_LINE_CHARS);
      const cut = space > 0 ? space : NOTE_LINE_CHARS;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(space > 0 ? cut + 1 : cut);
    }
    lines.push(rest);
  }
  return lines.length > NOTE_LINES ? null : lines.join('\n');
}
