import { describe, it, expect } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { httpClient, ApiError, extractErrorMessage, extractErrorDetails, extractErrorReason } from './client';

describe('httpClient', () => {
  it('prefixes requests with env.apiUrl', async () => {
    const mock = new MockAdapter(httpClient);
    mock.onGet('/things').reply(200, { hello: 'world' });

    const { data } = await httpClient.get<{ hello: string }>('/things');

    expect(mock.history.get[0].baseURL).toBe('http://localhost:3000');
    expect(data).toEqual({ hello: 'world' });

    mock.restore();
  });

  // axios's default params serializer emits bracketed indices for array
  // values (`tagIds[]=a&tagIds[]=b`), which express@5's default `simple`
  // query parser never un-brackets — the key arrives literally as
  // `tagIds[]` and the global ValidationPipe's `forbidNonWhitelisted` 400s
  // on it. The fix is `paramsSerializer: { indexes: null }` on the shared
  // instance; this asserts the wire format directly rather than relying on
  // a mocked request (axios-mock-adapter hands handlers the raw
  // `config.params` object, pre-serialization, so it can't see this bug
  // either).
  it('serializes array params as repeated bare keys, not bracketed indices', () => {
    const uri = httpClient.getUri({ url: '/x', params: { tagIds: ['a', 'b'] } });

    expect(uri).toContain('tagIds=a&tagIds=b');
    expect(uri).not.toContain('tagIds[]');
  });
});

describe('extractErrorMessage', () => {
  it('returns a string message as-is', () => {
    expect(extractErrorMessage(403, { message: 'Forbidden' })).toBe('Forbidden');
  });

  it('joins an array of messages', () => {
    expect(extractErrorMessage(400, { message: ['a', 'b'] })).toBe('a; b');
  });

  it('falls back to a generic message when the body has none', () => {
    expect(extractErrorMessage(500, {})).toBe('Request failed with status 500');
  });
});

describe('extractErrorDetails', () => {
  it('returns the raw message array as-is', () => {
    expect(extractErrorDetails({ message: ['name must not be empty', 'age must be positive'] })).toEqual([
      'name must not be empty',
      'age must be positive',
    ]);
  });

  it('returns undefined when message is a single string', () => {
    expect(extractErrorDetails({ message: 'Forbidden' })).toBeUndefined();
  });

  it('returns undefined when the body has no message', () => {
    expect(extractErrorDetails({})).toBeUndefined();
  });
});

describe('ApiError', () => {
  it('preserves details alongside the flattened message', () => {
    const err = new ApiError(400, 'a; b', ['a', 'b']);

    expect(err.message).toBe('a; b');
    expect(err.status).toBe(400);
    expect(err.details).toEqual(['a', 'b']);
  });

  it('leaves details undefined when not provided', () => {
    const err = new ApiError(403, 'Forbidden');

    expect(err.details).toBeUndefined();
  });
});

describe('extractErrorReason', () => {
  it('returns the reason string when present', () => {
    expect(extractErrorReason({ reason: 'not_registered' })).toBe('not_registered');
  });

  it('returns undefined when reason is absent', () => {
    expect(extractErrorReason({ message: 'Forbidden' })).toBeUndefined();
  });

  it('returns undefined when reason is not a string', () => {
    expect(extractErrorReason({ reason: 42 })).toBeUndefined();
  });
});

describe('ApiError reason', () => {
  it('preserves the reason passed to the constructor', () => {
    const err = new ApiError(403, 'Forbidden', undefined, undefined, undefined, 'inactive');
    expect(err.reason).toBe('inactive');
  });

  it('leaves reason undefined when not provided', () => {
    expect(new ApiError(403, 'Forbidden').reason).toBeUndefined();
  });
});
