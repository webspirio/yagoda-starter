import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import en from '@/shared/lib/i18n/locales/en.json';
import { LanguageSwitcher } from './LanguageSwitcher';

afterEach(async () => {
  i18n.addResourceBundle('en', 'translation', en);
  await i18n.changeLanguage('en');
});

describe('LanguageSwitcher', () => {
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
