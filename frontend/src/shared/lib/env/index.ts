import { z } from 'zod';

const envSchema = z.object({
  VITE_API_URL: z
    .string()
    .min(1, 'VITE_API_URL is required')
    .refine(
      (value) => /^https?:\/\//.test(value) || value.startsWith('/'),
      'VITE_API_URL must be an absolute http(s) URL or a path starting with "/"',
    ),
});

export function parseEnv(raw: Record<string, string | undefined>): { apiUrl: string } {
  const parsed = envSchema.parse(raw);
  return {
    apiUrl: parsed.VITE_API_URL,
  };
}

export const env = parseEnv(import.meta.env);
