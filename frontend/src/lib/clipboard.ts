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
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied or insecure context — try the legacy path below.
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
