import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Grid, Loader, Stack } from '@mantine/core';
import { IconActivityHeartbeat, IconPill, IconUsers } from '@tabler/icons-react';
import { useAuth } from '../../auth/AuthProvider';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { UsageSection, type CentreStats } from '../../components/StatsCard';
import { DeltaText } from '../../components/stats/DeltaText';
import { MonthStepper } from '../../components/stats/MonthStepper';
import { currentMonth, networkTotals, shiftMonth } from '../../components/stats/month';
import { errorMessage } from '../../i18n/errors';
import { formatMonth } from '../../i18n/format';
import { useCentreId, useCentreStats } from './api';

/** One centre's month for its manager: headline numbers against last month, then medicines and supplies used. */
export function CentreStatsPage() {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const centreId = useCentreId();
  const [month, setMonth] = useState(currentMonth);
  const previousMonth = shiftMonth(month, -1);
  const stats = useCentreStats(month);
  const previous = useCentreStats(previousMonth);
  const centreName = me?.centres.find((c) => c.id === centreId)?.name;

  const s = stats.data;
  const p = previous.data;
  const meds = (x: CentreStats) => networkTotals([x]).medicines;
  const delta = (pick: (x: CentreStats) => number) =>
    s && p ? <DeltaText current={pick(s)} previous={pick(p)} previousMonth={previousMonth} /> : undefined;

  return (
    <Stack gap="md">
      <PageHeader
        title={t('centre.stats.title')}
        subtitle={[centreName, formatMonth(month, i18n.language)].filter(Boolean).join(' · ')}
      />
      <MonthStepper value={month} onChange={setMonth} />
      {stats.isPending && stats.fetchStatus !== 'idle' && <Loader />}
      {stats.isError && <Alert color="danger">{errorMessage(t, stats.error)}</Alert>}
      {s && (
        <>
          {/* two across on a phone with the third full width under them; three across from tablet width */}
          <Grid gutter="sm" data-centre-stats>
            <Grid.Col span={{ base: 6, sm: 4 }}>
              <StatCard value={s.sessions} label={t('stats.sessionsMonth')} icon={IconActivityHeartbeat} footer={delta((x) => x.sessions)} />
            </Grid.Col>
            <Grid.Col span={{ base: 6, sm: 4 }}>
              <StatCard value={s.patients} label={t('pm.dashboard.patients')} icon={IconUsers} footer={delta((x) => x.patients)} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <StatCard value={meds(s)} label={t('stats.medicinesUsed')} icon={IconPill} footer={delta(meds)} />
            </Grid.Col>
          </Grid>
          <Card padding="md">
            <UsageSection stats={s} />
          </Card>
        </>
      )}
    </Stack>
  );
}
