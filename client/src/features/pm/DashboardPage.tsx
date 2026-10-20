import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Group, Loader, SimpleGrid, Stack, Table, Text, VisuallyHidden } from '@mantine/core';
import { IconActivityHeartbeat, IconBuildingHospital, IconChartPie, IconPill, IconUsers } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { StatsCard, type CentreStats } from '../../components/StatsCard';
import { DeltaText } from '../../components/stats/DeltaText';
import { MonthStepper } from '../../components/stats/MonthStepper';
import { compareCentres, currentMonth, networkTotals, shiftMonth, type CentreComparison } from '../../components/stats/month';
import { errorMessage } from '../../i18n/errors';
import { formatMonth, formatMonthName, formatMonthShort } from '../../i18n/format';
import { useStats } from './api';

const SessionsChart = lazy(() => import('../../components/stats/SessionsChart'));

const zero = (c: CentreStats['centre']): CentreStats => ({ centre: c, sessions: 0, patients: 0, medicines: [], supplies: [] });

/** Sessions per centre this month and last month: the chart plus the same figures as a table. */
function Comparison({ rows, month, previousMonth }: { rows: CentreComparison[]; month: string; previousMonth: string }) {
  const { t, i18n } = useTranslation();
  return (
    <Card padding="md" data-comparison>
      <Stack gap="sm">
        <Stack gap={0}>
          <Text fw={600}>{t('stats.perCentre')}</Text>
          <Text size="sm" c="dimmed">
            {t('stats.perCentreHint', { month: formatMonthName(month, i18n.language), previous: formatMonthName(previousMonth, i18n.language) })}
          </Text>
        </Stack>
        <Suspense fallback={<Loader size="sm" />}>
          <SessionsChart rows={rows} month={month} previousMonth={previousMonth} />
        </Suspense>
        <Table verticalSpacing={8} horizontalSpacing={6} fz="sm" data-comparison-table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('common.centre')}</Table.Th>
              <Table.Th ta="end">{formatMonthShort(month, i18n.language)}</Table.Th>
              <Table.Th ta="end">{formatMonthShort(previousMonth, i18n.language)}</Table.Th>
              <Table.Th>
                <VisuallyHidden>{t('stats.change')}</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.id} data-comparison-row={r.name}>
                <Table.Td>{r.name}</Table.Td>
                <Table.Td ta="end" fw={700}>
                  {r.current}
                </Table.Td>
                <Table.Td ta="end">{r.previous}</Table.Td>
                <Table.Td>
                  <DeltaOnly current={r.current} previous={r.previous} previousMonth={previousMonth} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  );
}

/** The arrow and number only (the table's columns already name both months). */
const DeltaOnly = (p: { current: number; previous: number; previousMonth: string }) => (
  <Group justify="flex-end" wrap="nowrap" data-compact-delta>
    <DeltaText {...p} hideMonth />
  </Group>
);

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(currentMonth);
  const previousMonth = shiftMonth(month, -1);
  const stats = useStats(month);
  const previous = useStats(previousMonth);

  const data = stats.data;
  const prev = previous.data;
  const totals = data ? networkTotals(data) : null;
  const prevTotals = prev ? networkTotals(prev) : null;
  const prevById = new Map((prev ?? []).map((s) => [s.centre.id, s]));
  const delta = (pick: (n: ReturnType<typeof networkTotals>) => number) =>
    totals && prevTotals ? <DeltaText current={pick(totals)} previous={pick(prevTotals)} previousMonth={previousMonth} /> : undefined;

  return (
    <Stack gap="md">
      <PageHeader title={t('pm.dashboard.title')} subtitle={t('stats.networkSubtitle', { month: formatMonth(month, i18n.language) })} />
      <MonthStepper value={month} onChange={setMonth} />
      {stats.isPending && stats.fetchStatus !== 'idle' && <Loader />}
      {stats.isError && <Alert color="danger">{errorMessage(t, stats.error)}</Alert>}
      {previous.isError && <Alert color="danger">{errorMessage(t, previous.error)}</Alert>}
      {data?.length === 0 && <EmptyState icon={IconChartPie} title={t('pm.dashboard.empty')} hint={t('empty.dashboardHint')} />}
      {totals && data && data.length > 0 && (
        <>
          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" data-network-totals>
            <StatCard value={totals.centres} label={t('stats.centres')} icon={IconBuildingHospital} />
            <StatCard value={totals.sessions} label={t('stats.sessionsMonth')} icon={IconActivityHeartbeat} footer={delta((n) => n.sessions)} />
            <StatCard value={totals.patients} label={t('pm.dashboard.patients')} icon={IconUsers} footer={delta((n) => n.patients)} />
            <StatCard value={totals.medicines} label={t('stats.medicinesUsed')} icon={IconPill} footer={delta((n) => n.medicines)} />
          </SimpleGrid>
          {prev && <Comparison rows={compareCentres(data, prev)} month={month} previousMonth={previousMonth} />}
          <Text fw={700} size="lg" mt="xs">
            {t('stats.byCentre')}
          </Text>
          {data.map((s) => (
            <StatsCard
              key={s.centre.id}
              stats={s}
              previous={prev ? (prevById.get(s.centre.id) ?? zero(s.centre)) : undefined}
              previousMonth={previousMonth}
            />
          ))}
        </>
      )}
    </Stack>
  );
}
