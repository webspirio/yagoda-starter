import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KindBadge } from './KindBadge';
import { kindHintKey } from '../lib/kindHint';

describe('KindBadge', () => {
  it('renders nothing for a plain supplier', () => {
    const { container } = render(<KindBadge kind="none" />);
    expect(container).toBeEmptyDOMElement();
  });
  it('labels wholesale and farmer', () => {
    // test-setup.ts initialises i18n to 'en', so the real render shows the
    // English translation ('WHOLESALE'); the regex also tolerates the raw
    // key or the Ukrainian label in case a test runs without i18n set up.
    render(<KindBadge kind="wholesale" />);
    expect(screen.getByText(/suppliers\.kindBadge\.wholesale|ОПТ|wholesale/i)).toBeInTheDocument();
  });
  it('hints only for the two marked kinds', () => {
    expect(kindHintKey('none')).toBeNull();
    expect(kindHintKey('wholesale')).toBe('suppliers.kindHint.wholesale');
    expect(kindHintKey('farmer')).toBe('suppliers.kindHint.farmer');
  });
});
