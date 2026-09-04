import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { sessionAuthHooks } from '@/entities/user';

// Attached ONCE at module scope, never in beforeEach. `httpClient` is a shared
// axios singleton and `attachAuthInterceptors` is NOT idempotent: a second
// attachment stacks a second error handler that receives the FIRST handler's
// ApiError — an object with no `.response` — so `error?.response?.status` is
// undefined and `status ?? 0` collapses every status to 0. The first test
// passes and every later one fails with `expected 0 to be 401`.
attachAuthInterceptors(httpClient, sessionAuthHooks);
import { useSession } from '@/entities/user';
import { ProfilePage } from './ProfilePage';

let mock: MockAdapter;

const ME = {
  id: 'u1',
  username: 'alice',
  display_name: 'Alice',
  avatar_url: null,
  language_code: 'en',
};

// Radix Avatar preloads via `new Image()` and only commits the real <img>
// once that preloader fires `load` AND jsdom's `complete`/`naturalWidth`
// getters agree the load succeeded — jsdom never resolves those on its own
// (no `canvas` package installed here), so without this shim the fallback
// initials render forever and the URL-resolution test below has no <img> to
// assert against. Mirrors the shim in shared/ui/avatar.test.tsx.
let originalSrc: PropertyDescriptor | undefined;
let originalComplete: PropertyDescriptor | undefined;
let originalNaturalWidth: PropertyDescriptor | undefined;
beforeAll(() => {
  originalSrc = Object.getOwnPropertyDescriptor(window.Image.prototype, 'src');
  originalComplete = Object.getOwnPropertyDescriptor(window.Image.prototype, 'complete');
  originalNaturalWidth = Object.getOwnPropertyDescriptor(window.Image.prototype, 'naturalWidth');
  Object.defineProperty(window.Image.prototype, 'complete', {
    configurable: true,
    get() {
      return Boolean((this as { __fakeLoaded?: boolean }).__fakeLoaded);
    },
  });
  Object.defineProperty(window.Image.prototype, 'naturalWidth', {
    configurable: true,
    get() {
      return (this as { __fakeLoaded?: boolean }).__fakeLoaded ? 1 : 0;
    },
  });
  Object.defineProperty(window.Image.prototype, 'src', {
    configurable: true,
    get() {
      return originalSrc?.get?.call(this);
    },
    set(value: string) {
      originalSrc?.set?.call(this, value);
      queueMicrotask(() => {
        (this as { __fakeLoaded?: boolean }).__fakeLoaded = true;
        this.dispatchEvent(new Event('load'));
      });
    },
  });
});
afterAll(() => {
  if (originalSrc) Object.defineProperty(window.Image.prototype, 'src', originalSrc);
  if (originalComplete) Object.defineProperty(window.Image.prototype, 'complete', originalComplete);
  if (originalNaturalWidth) {
    Object.defineProperty(window.Image.prototype, 'naturalWidth', originalNaturalWidth);
  }
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    useSession.setState({ token: 'tok' });
    mock = new MockAdapter(httpClient);
    mock.onGet('/me').reply(200, ME);
  });
  afterEach(() => mock.restore());

  it('shows a skeleton before the profile loads', () => {
    renderPage();
    expect(screen.getByTestId('profile-skeleton')).toBeInTheDocument();
  });

  it('renders the loaded profile', async () => {
    renderPage();
    expect(await screen.findByDisplayValue('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('saves an edited display name', async () => {
    mock.onPatch('/me').reply(200, { ...ME, display_name: 'Alicia' });
    renderPage();

    const input = await screen.findByDisplayValue('Alice');
    await userEvent.clear(input);
    await userEvent.type(input, 'Alicia');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByDisplayValue('Alicia')).toBeInTheDocument();
    expect(mock.history.patch).toHaveLength(1);
    expect(JSON.parse(mock.history.patch[0].data)).toEqual({ display_name: 'Alicia' });
  });

  it('shows an error when the profile fails to load', async () => {
    mock.onGet('/me').reply(500, { message: 'boom' });
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  // Pins the defect this task most easily reintroduces: the API returns
  // avatar_url as a path rooted at ITS OWN origin, not the app's. Rendering
  // it bare would resolve against the Vite dev server in a real deployment
  // and 404. resolveUploadUrl must resolve it against env.apiUrl instead.
  it('resolves the avatar URL against the API origin, not the app origin', async () => {
    mock.onGet('/me').reply(200, { ...ME, avatar_url: '/uploads/avatars/x.webp' });
    renderPage();

    const img = await screen.findByRole('img', { name: 'Alice' });
    expect(img).toHaveAttribute('src', 'http://localhost:3000/uploads/avatars/x.webp');
  });
});
