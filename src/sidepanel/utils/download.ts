import { ensurePngBlob } from './chatSender';

/**
 * Reliable file download utility for Chrome/Edge Extension Side Panels.
 * Prefers `chrome.downloads.download` (guaranteed native browser download),
 * falling back to an attached DOM anchor click when unavailable.
 */
function sanitizeFilename(raw: string): string {
  return (
    raw
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'stylelens-export'
  );
}

/**
 * Unicode-safe filename slug preserving both Latin and CJK words (e.g. `rots`, `苹果`)
 * while removing unsafe path characters and collapsing whitespace.
 */
export function slugifyFilenamePart(raw: string, fallback = 'stylelens'): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ')
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return cleaned || fallback;
}

export async function downloadBlob(blob: Blob, rawFilename: string): Promise<boolean> {
  const filename = sanitizeFilename(rawFilename);
  const url = URL.createObjectURL(blob);

  try {
    if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
      await chrome.downloads.download({
        url,
        filename,
        saveAs: false,
      });
      // 30s window prevents premature revocation when Chrome's "Ask where to save" dialog is open
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return true;
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 15_000);
    return true;
  } catch {
    URL.revokeObjectURL(url);
    return false;
  }
}

export async function downloadDataUrlPng(dataUrl: string, rawFilename: string): Promise<boolean> {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return false;
  try {
    const resp = await fetch(dataUrl);
    const rawBlob = await resp.blob();
    const pngBlob = await ensurePngBlob(rawBlob);
    return downloadBlob(pngBlob, rawFilename);
  } catch {
    return false;
  }
}

export async function downloadText(
  content: string,
  filename: string,
  mimeType = 'text/plain'
): Promise<boolean> {
  const blob = new Blob([content], { type: mimeType });
  return downloadBlob(blob, filename);
}
