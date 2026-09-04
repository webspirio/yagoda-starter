import { create } from 'zustand';

export const TOKEN_STORAGE_KEY = 'web-starter.token';

/**
 * The access token, mirrored into localStorage so a reload stays signed in.
 *
 * Every localStorage access is wrapped: the accessor itself throws in a
 * private window or when a browser is set to block site data, and an
 * exception here would take the whole app down at import time.
 */
function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(TOKEN_STORAGE_KEY);
    else localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // In-memory state still holds the token — the session works for this tab
    // and simply does not survive a reload.
  }
}

interface SessionState {
  token: string | null;
  setToken: (token: string | null) => void;
}

export const useSession = create<SessionState>((set) => ({
  token: readStoredToken(),
  setToken: (token) => {
    writeStoredToken(token);
    set({ token });
  },
}));
