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

export async function register(body: Credentials): Promise<TokenResponse> {
  const { data } = await httpClient.post<TokenResponse>('/auth/register', body);
  return data;
}

/** The token is stateless, so this is a courtesy call the backend logs; the
 *  actual sign-out is clearing the session store. Never let a failure here
 *  block the sign-out. */
export async function logout(): Promise<void> {
  await httpClient.post('/auth/logout');
}
