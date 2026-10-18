import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { errorMessage } from '../../i18n/errors';
import { formatDay, useOverview, type MiniSession } from './api';
import { InstallPrompt } from './InstallPrompt';
import { useNotifications } from './useNotifications';

function SessionRow({ s }: { s: MiniSession }) {
  const { t, i18n } = useTranslation();
  return (
    <Card withBorder p="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div>
          <Text fw={600}>{formatDay(s.date, i18n.language)}</Text>
          <Text>
            {s.start}–{s.end}
          </Text>
          <Text size="sm" c="dimmed">
            {s.centreName}
          </Text>
        </div>
        {s.kind === 'makeup' && <Badge variant="light">{t('me.makeup')}</Badge>}
      </Group>
    </Card>
  );
}

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
  const { active, upcoming, patient, centre } = q.data;

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
      <InstallPrompt />
      <Reminders />
      <Title order={3}>{t('me.upcoming')}</Title>
      {upcoming.length === 0 ? (
        <Text c="dimmed">{t('me.noUpcoming')}</Text>
      ) : (
        <Stack gap="sm">
          {upcoming.map((s) => (
            <SessionRow key={s.id} s={s} />
          ))}
        </Stack>
      )}
      <Button component={Link} to="/me/history" variant="default" mih={44}>
        {t('me.history')}
      </Button>
    </Stack>
  );
}
