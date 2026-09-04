import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/dom';
import { i18n, initI18n } from './shared/lib/i18n';

/**
 * Testing Library's async utilities (`findBy*`, `waitFor`) default to a 1000ms
 * budget. That is fine for a state flush, but some screens await a `lazy()`
 * dynamic import, and resolving one of those chunks means a Vite transform in
 * a cold worker process — that routinely outruns 1000ms under a full-suite
 * run, which is what makes those files intermittently red while passing in
 * isolation.
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
global.ResizeObserver = ResizeObserverStub;

// jsdom doesn't implement pointer capture; vaul (the bottom-sheet drawer)
// calls setPointerCapture on pointerdown inside the sheet and would throw on
// every click a test makes there.
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

// Some hooks persist form drafts or UI state to localStorage/sessionStorage
// on mount. A single global clear here covers every test that touches one of
// them, present and future, instead of a per-file beforeEach that would need
// updating every time a new test starts rendering such a component.
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
