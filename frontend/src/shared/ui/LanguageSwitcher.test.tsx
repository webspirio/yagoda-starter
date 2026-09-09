import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageSwitcher } from './LanguageSwitcher';

describe('LanguageSwitcher', () => {
  it('offers each configured locale (uk + en)', () => {
    render(<LanguageSwitcher />);
    // Two locales are configured now, so the control renders (it hides only
    // when a single locale would make it a dead control).
    expect(screen.getByText('UK')).toBeInTheDocument();
    expect(screen.getByText('EN')).toBeInTheDocument();
  });
});
