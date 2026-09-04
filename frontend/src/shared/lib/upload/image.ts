import { env } from '@/shared/lib/env';

/** 10 MB — mirrors the backend's max upload size. UX only; the server
 *  re-checks via multer + magic bytes. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Pre-upload validation (the server re-checks by magic bytes — this is UX, not
 * security). Returns the failure kind or null when the file looks fine.
 */
export function validateImageFile(file: Pick<File, 'type' | 'size'>): 'type' | 'size' | null {
  if (!IMAGE_TYPES.includes(file.type)) return 'type';
  if (file.size > IMAGE_MAX_BYTES) return 'size';
  return null;
}

/**
 * Turn a `/uploads/<name>` path into a browser-loadable URL against the API
 * origin (the uploads static host is the API origin, not the app's own
 * origin). Absolute / blob / data URLs pass through untouched.
 */
export function resolveUploadUrl(url: string): string {
  if (/^(https?:|blob:|data:)/i.test(url)) return url;
  try {
    return new URL(url, env.apiUrl).href;
  } catch {
    return url;
  }
}
