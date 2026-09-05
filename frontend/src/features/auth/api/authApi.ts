import { httpClient } from '@/shared/api';

export interface Credentials {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
}

export async function login(body: Credentials): Promise<TokenResponse> {
  const { data } = await httpClient.post<TokenResponse>('/auth/login', body);
  return data;
}

/**
 * The token is stateless, so this is a courtesy call the backend logs; the
 * actual sign-out is clearing the session store. Never let a failure here
 * block the sign-out.
 *
 * `/auth/logout` now requires a valid token (it records an audit entry), so
 * the caller passes the OUTGOING token explicitly here rather than relying
 * on the request interceptor to read it live off the session store: the
 * caller clears that store first (sign-out must not wait on the network),
 * and by the time this request's interceptor ran there would be nothing left
 * to send. Passing it explicitly makes the call correct regardless of that
 * ordering.
 */
export async function logout(token?: string | null): Promise<void> {
  await httpClient.post('/auth/logout', undefined, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}
