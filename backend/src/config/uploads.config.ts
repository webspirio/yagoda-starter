import { registerAs } from '@nestjs/config';
import { resolve } from 'path';

/**
 * Local storage for user-uploaded files (e.g. avatars).
 *
 * Single source of truth shared by `main.ts` (serves `dir` as static assets
 * under `publicPrefix`) and whichever feature module writes into `dir` and
 * hands back `publicPrefix`-rooted URLs. Change the on-disk location via
 * `UPLOADS_DIR` (default `<cwd>/uploads`, matched by the prod volume mount);
 * the public prefix lives here, not scattered across call sites.
 */
export const uploadsConfig = registerAs('uploads', () => ({
  dir: resolve(process.env.UPLOADS_DIR ?? './uploads'),
  publicPrefix: '/uploads',
}));
