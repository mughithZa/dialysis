import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstallPrompt } from './InstallPrompt';
import { captureInstallPrompt } from './installEvent';
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

  it('keeps an Android beforeinstallprompt fired before mount and installs on tap', async () => {
    mm(false);
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36');
    captureInstallPrompt();
    const prompt = vi.fn().mockResolvedValue(undefined);
    window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt }));
    renderApp(<InstallPrompt />);
    await userEvent.click(screen.getByRole('button', { name: 'Install app' }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
  });
});
