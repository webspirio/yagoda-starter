import MockAdapter from 'axios-mock-adapter';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, ApiError, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks } from '@/entities/user';
import { login, register, logout } from './authApi';

// Attached once at module scope, matching the pattern the source project's
// own attachAuthInterceptors tests use — the shared httpClient instance is a
// module singleton, so calling this inside beforeEach would stack a fresh
// pair of interceptors on every test in this file. By the second test the
// first interceptor's Promise.reject(ApiError) would flow into the second
// interceptor's error handler, which reads `error.response.status` off an
// ApiError (which has no `.response`) and rewraps it with status 0 — losing
// the real status entirely.
attachAuthInterceptors(httpClient, sessionAuthHooks);

describe('authApi', () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(httpClient);
  });

  afterEach(() => mock.restore());

  it('returns the access token on a successful login', async () => {
    mock.onPost('/auth/login').reply(200, { access_token: 'tok' });
    await expect(login({ username: 'alice', password: 'hunter2!!' })).resolves.toEqual({
      access_token: 'tok',
    });
  });

  it('surfaces a 401 as an ApiError carrying the status', async () => {
    mock.onPost('/auth/login').reply(401, { message: 'Invalid username or password' });
    const error = await login({ username: 'alice', password: 'nope' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
  });

  it('surfaces a 409 on a taken username', async () => {
    mock.onPost('/auth/register').reply(409, { message: 'That username is taken' });
    const error = await register({ username: 'alice', password: 'hunter2!!' }).catch((e) => e);
    expect(error.status).toBe(409);
  });

  it('posts to logout', async () => {
    mock.onPost('/auth/logout').reply(204);
    await expect(logout()).resolves.toBeUndefined();
  });
});
