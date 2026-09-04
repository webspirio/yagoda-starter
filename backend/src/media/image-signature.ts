/**
 * Hand-rolled image magic-byte sniffing for uploaded files (see the design
 * spec): the client-supplied mimetype and filename extension are NEVER
 * trusted — only the leading bytes decide. No new deps.
 */

export type ImageKind = 'jpeg' | 'png' | 'webp';

/** Canonical file extension per detected kind. */
export const IMAGE_EXTENSIONS: Record<ImageKind, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Detect jpeg/png/webp from a buffer's magic bytes; null for anything else
 * (including truncated files shorter than the signature).
 */
export function sniffImage(buffer: Buffer): ImageKind | null {
  // JPEG: FF D8 FF
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer.length >= 8 && PNG_SIGNATURE.every((b, i) => buffer[i] === b)) {
    return 'png';
  }
  // WebP: RIFF <4-byte size> WEBP
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}
