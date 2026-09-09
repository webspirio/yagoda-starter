import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useThemePreference } from '@/shared/lib/theme';
import { expectNoAxeViolations } from '../../test-axe';
import { ThemeToggle } from './theme-toggle';

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  useThemePreference.setState({ preference: 'system' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('is a single pressed/unpressed toggle — no menu — and flips light ⇄ dark', async () => {
  mockMatchMedia(false);
  const { container } = render(<ThemeToggle />);
  const toggle = screen.getByRole('button', { name: 'Theme' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(toggle).toHaveAttribute('title', 'Dark');
  expect(screen.queryByRole('menu')).toBeNull();
  await expectNoAxeViolations(container);

  await userEvent.click(toggle);
  expect(useThemePreference.getState().preference).toBe('dark');
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(toggle).toHaveAttribute('title', 'Light');

  await userEvent.click(toggle);
  expect(useThemePreference.getState().preference).toBe('light');
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

it("resolves a 'system' preference against the OS so the first press goes the right way", async () => {
  mockMatchMedia(true);
  render(<ThemeToggle />);
  const toggle = screen.getByRole('button', { name: 'Theme' });
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(toggle);
  expect(useThemePreference.getState().preference).toBe('light');
});
