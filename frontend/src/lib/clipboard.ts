/**
 * Copy a string to the clipboard.
 *
 * Uses the async Clipboard API when available and falls back to a hidden
 * textarea + `execCommand('copy')` for browsers/contexts where it is not
 * (e.g. plain-http dev servers, older mobile browsers).
 *
 * Returns whether the value ended up in the clipboard.
 */
export async function copyToClipboard(value: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return false;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied or insecure context — try the legacy path below.
  }

  const textarea = document.createElement('textarea');
  try {
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
