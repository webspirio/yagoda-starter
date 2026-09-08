import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';
import { i18n, initI18n } from './shared/lib/i18n';

/**
 * Testing Library's async utilities (`findBy*`, `waitFor`) default to a 1000ms
 * budget. That is fine for a single file run in isolation, but a full-suite
 * run executes every test file's worker concurrently, and the resulting CPU
 * contention can push an otherwise-fast mocked round trip (axios-mock-adapter
 * resolving, a re-render, a DOM query) past 1000ms on a busy machine or CI
 * runner — which is what makes a handful of files intermittently red under
 * the full suite while passing every time in isolation.
 *
 * Raised globally rather than per call site: per-test bumps are whack-a-mole
 * against a moving threshold. This does NOT slow the suite — a passing
 * assertion resolves as soon as its condition holds; the budget only bounds
 * how long a failure takes to report.
 *
 * `testTimeout` (vite.config.ts) must stay comfortably above this, or a test
 * would die on the vitest timeout before its own `waitFor` could report the
 * far more useful "unable to find element" message.
 */
configure({ asyncUtilTimeout: 5000 });

initI18n();
void i18n.changeLanguage('en');

// jsdom doesn't implement ResizeObserver; Radix's Popper-based components
// (e.g. Tooltip) read element size on mount and throw without a stub. The
// constructor/observe/unobserve signatures mirror the real ResizeObserver so
// callers that pass the required callback/target resolve against a faithful
// shape and static analysis doesn't flag them as passing a superfluous
// argument. The params are intentionally unused: the stub stays a no-op
// (invoking the callback could re-enter Radix's measure loop).
/* eslint-disable @typescript-eslint/no-unused-vars */
class ResizeObserverStub {
  constructor(_callback: ResizeObserverCallback) {}
  observe(_target: Element) {}
  unobserve(_target: Element) {}
  disconnect() {}
}
/* eslint-enable @typescript-eslint/no-unused-vars */
globalThis.ResizeObserver = ResizeObserverStub;

// jsdom doesn't implement pointer capture; vaul (the bottom-sheet drawer)
// calls setPointerCapture on pointerdown inside the sheet and would throw on
// every click a test makes there.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

// jsdom doesn't implement matchMedia; useAppTheme (mounted by AppLayout, so
// every test that renders the real router tree hits this) and useIsDesktop
// both call window.matchMedia() unconditionally on mount. Default to "no
// preference matches" (light theme, mobile layout) — a neutral baseline a
// test can override per-file with vi.stubGlobal('matchMedia', …) (see
// useAppTheme.test.ts / AppLayout.test.tsx for that pattern) when the
// specific match value is what's under test.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Some hooks persist form drafts or UI state to localStorage/sessionStorage
// on mount. A single global clear here covers every test that touches one of
// them, present and future, instead of a per-file beforeEach that would need
// updating every time a new test starts rendering such a component.
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
