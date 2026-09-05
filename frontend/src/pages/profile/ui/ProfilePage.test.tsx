import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MockAdapter from 'axios-mock-adapter';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import { IMAGE_MAX_BYTES } from '@/shared/lib/upload';
import { Toaster } from '@/shared/ui/sonner';
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
  display_name: 'Alice Operator',
  avatar_url: null,
  language_code: null,
  role: 'point_operator',
  collection_point_id: 'p1',
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
      {/* Mounted here (rather than relying on AppLayout) because the toast
          failure-path tests assert on rendered toast text, and sonner's
          `toast()` calls are inert until a <Toaster/> is in the tree. */}
      <Toaster />
    </QueryClientProvider>,
  );
}

/** A same-content, same-type file the picker's client-side checks accept. */
function validAvatarFile() {
  return new File(['x'], 'avatar.png', { type: 'image/png' });
}

/** Drives the hidden file input `ImagePicker` wires an onChange to — see
 * image-picker.tsx: the button that's visible/clickable only opens this
 * input, so tests go straight at the input via a change event rather than
 * simulating a click-then-pick round trip through a real OS file dialog. */
function pickAvatarFile(file: File) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
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
    expect(await screen.findByText('Alice Operator')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
  });

  it('shows the name as read-only text, with no field to edit it', async () => {
    renderPage();
    expect(await screen.findByText('Alice Operator')).toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
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

    const img = await screen.findByRole('img', { name: 'Alice Operator' });
    expect(img).toHaveAttribute('src', 'http://localhost:3000/uploads/avatars/x.webp');
  });

  it('uploads a picked avatar and renders the returned image', async () => {
    mock.onPost('/me/avatar').reply(200, { ...ME, avatar_url: '/uploads/avatars/new.webp' });
    renderPage();
    await screen.findByText('Alice Operator');

    pickAvatarFile(validAvatarFile());

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    const img = await screen.findByRole('img', { name: 'Alice Operator' });
    expect(img).toHaveAttribute('src', 'http://localhost:3000/uploads/avatars/new.webp');
  });

  it('rejects an oversized avatar client-side and never calls the API', async () => {
    renderPage();
    await screen.findByText('Alice Operator');

    const tooBig = new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], 'huge.png', {
      type: 'image/png',
    });
    pickAvatarFile(tooBig);

    expect(await screen.findByText('Image must be smaller than 10 MB')).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it('rejects a non-image avatar client-side and never calls the API', async () => {
    renderPage();
    await screen.findByText('Alice Operator');

    const wrongType = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
    pickAvatarFile(wrongType);

    expect(await screen.findByText('Image must be JPEG, PNG or WebP')).toBeInTheDocument();
    expect(mock.history.post).toHaveLength(0);
  });

  it('shows an error toast when the avatar upload fails', async () => {
    mock.onPost('/me/avatar').reply(500, { message: 'boom' });
    renderPage();
    await screen.findByText('Alice Operator');

    pickAvatarFile(validAvatarFile());

    expect(await screen.findByText('Could not upload that image')).toBeInTheDocument();
  });

  // Two picks in quick succession must not start two concurrent uploads:
  // whichever response lands LAST would win in setQueryData regardless of
  // which file was picked last, so a user correcting a mistaken upload with
  // a faster second one could end up with the first, wrong avatar persisted.
  it('ignores a second pick while an avatar upload is already in flight', async () => {
    let resolveFirstUpload: (() => void) | undefined;
    mock.onPost('/me/avatar').reply(
      () =>
        new Promise((resolve) => {
          resolveFirstUpload = () =>
            resolve([200, { ...ME, avatar_url: '/uploads/avatars/first.webp' }]);
        }),
    );
    renderPage();
    await screen.findByText('Alice Operator');

    pickAvatarFile(new File(['a'], 'a.png', { type: 'image/png' }));
    await waitFor(() => expect(mock.history.post).toHaveLength(1));

    pickAvatarFile(new File(['b'], 'b.png', { type: 'image/png' }));
    // Give an (incorrect) second request a tick to fire before asserting it
    // did not — this is the assertion the removed-guard regression run
    // (see report) confirms is actually exercised.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mock.history.post).toHaveLength(1);

    resolveFirstUpload?.();
    await waitFor(() => expect(mock.history.post).toHaveLength(1));
  });
});
