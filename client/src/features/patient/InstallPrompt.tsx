import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CloseButton, Group, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconDeviceMobile, IconDownload } from '@tabler/icons-react';
import { clearInstallPrompt, getInstallPrompt, subscribeInstallPrompt } from './installEvent';

const DISMISS_KEY = 'installPromptDismissed';

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIosSafari = () => {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
};

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Android: installs via the captured `beforeinstallprompt`. iOS Safari: how-to text. Hidden once installed. */
export function InstallPrompt() {
  const { t } = useTranslation();
  const event = useSyncExternalStore(subscribeInstallPrompt, getInstallPrompt);
  const [dismissed, setDismissed] = useState(wasDismissed);

  if (dismissed || isStandalone()) return null;
  const ios = isIosSafari();
  if (!event && !ios) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode: dismissal lasts until reload */
    }
  };
  const install = async () => {
    if (!event) return;
    await event.prompt();
    clearInstallPrompt();
  };

  return (
    <Card padding="md" bg="var(--mantine-color-uoca-0)" data-testid="install-prompt">
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <ThemeIcon variant="light" color="uoca" size={40} radius="xl" aria-hidden>
          <IconDeviceMobile size={22} />
        </ThemeIcon>
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600}>{t('me.install.title')}</Text>
          {event ? (
            <>
              <Text size="sm" c="dimmed">
                {t('me.install.hint')}
              </Text>
              <Button mt={4} mih={44} leftSection={<IconDownload size={18} />} onClick={() => void install()}>
                {t('me.install.button')}
              </Button>
            </>
          ) : (
            <Text size="sm">{t('me.install.ios')}</Text>
          )}
        </Stack>
        <CloseButton size="lg" aria-label={t('me.install.dismiss')} onClick={dismiss} />
      </Group>
    </Card>
  );
}
