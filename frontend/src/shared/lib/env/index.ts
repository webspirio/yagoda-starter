// `zod/mini`, not `zod`: this module sits in every visitor's first paint, and
// the chained API pulled the whole library into it (~18 KiB gzip) to check one
// string. The functional build tree-shakes down to what is used.
import * as z from 'zod/mini';

const envSchema = z.object({
  VITE_API_URL: z.string().check(
    z.minLength(1, 'VITE_API_URL is required'),
    z.refine(
      (value) => /^https?:\/\//.test(value) || value.startsWith('/'),
      'VITE_API_URL must be an absolute http(s) URL or a path starting with "/"',
    ),
  ),
});

export function parseEnv(raw: Record<string, string | undefined>): { apiUrl: string } {
  const parsed = envSchema.parse(raw);
  return {
    apiUrl: parsed.VITE_API_URL,
  };
}

export const env = parseEnv(import.meta.env);
