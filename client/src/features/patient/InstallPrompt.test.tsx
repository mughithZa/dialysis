import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { InstallPrompt } from './InstallPrompt';
import { renderApp } from '../../test/render';

const mm = (standalone: boolean) =>
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q) => ({ matches: standalone && q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  );

afterEach(() => vi.restoreAllMocks());

describe('InstallPrompt', () => {
  it('is hidden when already standalone', () => {
    mm(true);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone Safari');
    renderApp(<InstallPrompt />);
    expect(screen.queryByText('Tap Share, then Add to Home Screen')).not.toBeInTheDocument();
  });

  it('shows iOS instructions in Safari', () => {
    mm(false);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17.0 Mobile Safari/604.1');
    renderApp(<InstallPrompt />);
    expect(screen.getByText('Tap Share, then Add to Home Screen')).toBeVisible();
  });
});
