import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import en from '@/shared/lib/i18n/locales/en.json';
import { getStoredLanguage } from '@/shared/lib/i18n/language-preference';
import { LanguageSwitcher } from './LanguageSwitcher';

afterEach(async () => {
  vi.restoreAllMocks();
  i18n.addResourceBundle('en', 'translation', en);
  await i18n.changeLanguage('en');
});

describe('LanguageSwitcher', () => {
  it('persists nothing when the switch fails, so the next start does not block on it', async () => {
    await i18n.changeLanguage('uk');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const change = vi.spyOn(i18n, 'changeLanguage').mockRejectedValueOnce(new Error('chunk failed'));
    render(<LanguageSwitcher />);
    await userEvent.click(screen.getByText('EN'));
    await waitFor(() => expect(change).toHaveBeenCalledWith('en'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getStoredLanguage()).toBeNull();
  });

  it('loads English before switching to it', async () => {
    await i18n.changeLanguage('uk');
    i18n.removeResourceBundle('en', 'translation'); // as in production, before en is fetched
    render(<LanguageSwitcher />);
    await userEvent.click(screen.getByText('EN'));
    await waitFor(() => expect(i18n.resolvedLanguage).toBe('en'));
    expect(i18n.t('lang.label')).toBe('Language');
  });

  it('offers each configured locale (uk + en)', () => {
    render(<LanguageSwitcher />);
    // Two locales are configured now, so the control renders (it hides only
    // when a single locale would make it a dead control).
    expect(screen.getByText('UK')).toBeInTheDocument();
    expect(screen.getByText('EN')).toBeInTheDocument();
  });
});
