import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, CloseButton, Group, Paper, Text } from '@mantine/core';

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

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
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(wasDismissed);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

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
    setEvent(null);
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text fw={600}>{t('me.install.title')}</Text>
          {event ? (
            <Button mt="xs" mih={44} onClick={() => void install()}>
              {t('me.install.button')}
            </Button>
          ) : (
            <Text size="sm" mt={4}>
              {t('me.install.ios')}
            </Text>
          )}
        </div>
        <CloseButton size="lg" aria-label={t('me.install.dismiss')} onClick={dismiss} />
      </Group>
    </Paper>
  );
}
