/** The receipt's ruled lines: seven, forty monospace characters each — what
 *  fits the slip on paper. The backend refuses a note past either. */
export const NOTE_LINES = 7;
export const NOTE_LINE_CHARS = 40;

export interface NetworkSettings {
  /** Already wrapped onto the lines with `\n`; `null` prints them blank. */
  receipt_note: string | null;
  updated_at: string;
}
