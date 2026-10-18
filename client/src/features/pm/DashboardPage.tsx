import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Loader, Stack, Text, TextInput, Title } from '@mantine/core';
import { StatsCard } from '../../components/StatsCard';
import { errorMessage } from '../../i18n/errors';
import { useStats } from './api';

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export function DashboardPage() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(currentMonth);
  const stats = useStats(month);

  return (
    <Stack gap="md">
      <Title order={2}>{t('pm.dashboard.title')}</Title>
      <TextInput type="month" label={t('pm.dashboard.month')} value={month} onChange={(e) => setMonth(e.currentTarget.value)} maw={240} />
      {stats.isPending && stats.fetchStatus !== 'idle' && <Loader />}
      {stats.isError && <Alert color="danger">{errorMessage(t, stats.error)}</Alert>}
      {stats.data?.length === 0 && <Text c="dimmed">{t('pm.dashboard.empty')}</Text>}
      {stats.data?.map((s) => <StatsCard key={s.centre.id} stats={s} />)}
    </Stack>
  );
}
