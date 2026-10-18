import { useTranslation } from 'react-i18next';
import { Stack, Text, Title } from '@mantine/core';

/** Shared body for placeholder screens that later tasks replace. */
export function ComingSoon({ titleKey }: { titleKey: string }) {
  const { t } = useTranslation();
  return (
    <Stack gap="xs">
      <Title order={2}>{t(titleKey)}</Title>
      <Text c="dimmed">{t('common.comingSoon')}</Text>
    </Stack>
  );
}
