/**
 * A long receipt scrolls INSIDE the dialog, between a fixed header and footer,
 * so «Друк»/«Анулювати» stay on screen at 1440×900 (audit 2026-10-24 A4). A
 * flex column, not the primitive's grid: flex items shrink to the dialog's
 * `max-height`, grid tracks would not. On paper the print rules in
 * `index.css` lift the dialog's cap, and `print:overflow-visible` the body's.
 */
export const RECEIPT_DIALOG_CLASS = 'flex flex-col overflow-hidden sm:w-[420px] sm:max-w-[420px]';
export const RECEIPT_SCROLL_CLASS =
  '-mx-4 min-h-0 flex-1 overflow-y-auto px-4 print:mx-0 print:overflow-visible print:px-0';
