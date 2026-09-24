import { createQueryClient } from './cachePolicy';

/** The app's one client. Freshness is decided in `cachePolicy.ts`, nowhere else. */
export const queryClient = createQueryClient();
