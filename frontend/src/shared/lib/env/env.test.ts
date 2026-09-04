import { describe, expect, it } from 'vitest';
import { parseEnv } from './index';

describe('parseEnv', () => {
  it('accepts an absolute http(s) URL', () => {
    const result = parseEnv({ VITE_API_URL: 'https://api.example.com' });
    expect(result.apiUrl).toBe('https://api.example.com');
  });

  it('accepts a relative path starting with "/"', () => {
    const result = parseEnv({ VITE_API_URL: '/api' });
    expect(result.apiUrl).toBe('/api');
  });

  it('throws when VITE_API_URL is missing', () => {
    expect(() => parseEnv({})).toThrow();
  });

  it('throws when VITE_API_URL is an empty string', () => {
    expect(() => parseEnv({ VITE_API_URL: '' })).toThrow();
  });

  it('throws when VITE_API_URL is neither an absolute URL nor a path', () => {
    expect(() => parseEnv({ VITE_API_URL: 'not-a-url-or-path' })).toThrow();
  });
});
