import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Loader, Stack, Text, Title } from '@mantine/core';
import { Timeline } from '../../components/Timeline';
import { formatDay } from '../../components/timelineApi';
import { todayLocal } from '../desk/dates';
import { errorMessage } from '../../i18n/errors';
import { useOverview } from './api';
import { InstallPrompt } from './InstallPrompt';
import { useNotifications } from './useNotifications';

function Reminders() {
  const { t } = useTranslation();
  const { status, enable } = useNotifications();
  const [failed, setFailed] = useState(false);
  if (status === 'loading' || status === 'hidden') return null;
  if (status === 'denied') return <Text size="sm" c="dimmed">{t('me.notify.denied')}</Text>;
  if (status === 'on') return <Text size="sm" fw={500}>{t('me.notify.on')}</Text>;
  return (
    <Stack gap="xs">
      <Button
        variant="light"
        mih={44}
        onClick={() => {
          setFailed(false);
          enable().catch(() => setFailed(true));
        }}
      >
        {t('me.notify.enable')}
      </Button>
      {failed && (
        <Text size="sm" c="danger" role="alert">
          {t('me.notify.failed')}
        </Text>
      )}
    </Stack>
  );
}

export function MePage() {
  const { t, i18n } = useTranslation();
  const q = useOverview();

  if (q.isPending) return <Loader />;
  if (q.isError) return <Alert color="danger">{errorMessage(t, q.error)}</Alert>;
  const { active, patient, centre, upcoming } = q.data;
  const next = active ? undefined : upcoming[0];

  return (
    <Stack gap="md">
      <div>
        <Title order={2}>{patient.name}</Title>
        <Text c="dimmed">{centre.name}</Text>
      </div>
      {active && (
        <Alert color="warning" variant="filled" role="status" title={t('me.activeNow')}>
          <Text fw={600}>{formatDay(active.date, i18n.language)}</Text>
          <Text>
            {active.start}–{active.end}
          </Text>
        </Alert>
      )}
      {next && (
        <Card withBorder padding="md" role="status" aria-label={t('me.next')}>
          <Text size="sm" c="dimmed">
            {t('me.next')}
          </Text>
          <Text fw={700} size="lg">
            {next.date === todayLocal() ? t('me.today') : formatDay(next.date, i18n.language)}
          </Text>
          <Text>
            {next.start}–{next.end} · {next.centreName}
          </Text>
        </Card>
      )}
      <InstallPrompt />
      <Reminders />
      <Timeline source={{ kind: 'me' }} />
    </Stack>
  );
}
