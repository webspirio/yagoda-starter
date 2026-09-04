/** Copies text to the clipboard, falling back to execCommand for old Android/browsers lacking the async Clipboard API. */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    copyToClipboardFallback(text);
  }
}

function copyToClipboardFallback(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  // Off-screen so it doesn't flash on screen.
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.prepend(textarea);
  textarea.select();
  try {
    // Deprecated, but still the only working copy mechanism on old Android
    // WebViews that lack the async Clipboard API — kept as a last resort.
    document.execCommand('copy');
  } catch {
    // Nothing more we can do — the browser has no working copy mechanism.
  } finally {
    textarea.remove();
  }
}
