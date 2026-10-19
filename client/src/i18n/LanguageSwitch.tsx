import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Group, Stack, Text, useDirection } from '@mantine/core';
import { LANGUAGES } from '@dialysis/shared';
import { apiPut } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { currentLanguage, setLanguage } from '.';

/** Keeps Mantine's direction (and so every component's layout) in step with the interface language. */
export function DirectionSync() {
  const { i18n } = useTranslation();
  const { setDirection } = useDirection();
  useEffect(() => {
    setDirection(i18n.dir(i18n.language));
    const sync = (lng: string) => setDirection(i18n.dir(lng));
    i18n.on('languageChanged', sync);
    return () => i18n.off('languageChanged', sync);
  }, [i18n, setDirection]);
  return null;
}

/** Tells the server the signed-in user's language when it differs, so reminders arrive in that language. */
export function LanguageSync() {
  const { me } = useAuth();
  const { i18n } = useTranslation();
  const lng = currentLanguage();
  useEffect(() => {
    if (me && me.language !== lng) void apiPut('/auth/language', { language: lng }).catch(() => {});
  }, [me, lng, i18n.language]);
  return null;
}

/** "English | العربية" picker; each option is labelled in its own language so anyone can find theirs. */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <Stack gap={4} role="group" aria-labelledby="language-label">
      <Text size="sm" fw={500} id="language-label">
        {t('language.label')}
      </Text>
      <Group grow gap="xs">
        {LANGUAGES.map((l) => (
          <Button
            key={l}
            mih={44}
            lang={l}
            variant={i18n.language === l ? 'filled' : 'default'}
            aria-pressed={i18n.language === l}
            onClick={() => void setLanguage(l)}
          >
            {t(`language.${l}`)}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}
