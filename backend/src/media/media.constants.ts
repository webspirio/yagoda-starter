/** Single source of truth for the media size cap — 10 MB. Enforced upstream by
 *  each FileInterceptor's `limits.fileSize` (413 before the buffer lands) and
 *  mirrored client-side as IMAGE_MAX_BYTES for friendly UX. Any reverse proxy
 *  in front of the app must allow at least ~12 MB bodies, or uploads 413 before
 *  they ever reach Nest. */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** What an uploaded file is for — persisted on `media_files.purpose`.
 *
 *  One member on purpose: it demonstrates the per-purpose directory pattern
 *  without importing a domain. Adding a purpose means adding a member here, a
 *  subdirectory below, and an ALTER TYPE migration for the `media_purpose`
 *  Postgres enum. */
export enum MediaPurpose {
  Avatar = 'avatar',
}

/** Per-purpose on-disk subfolder under UPLOADS_DIR (and under the public
 *  `/uploads` prefix). */
export const MEDIA_SUBDIR: Record<MediaPurpose, string> = {
  [MediaPurpose.Avatar]: 'avatars',
};
