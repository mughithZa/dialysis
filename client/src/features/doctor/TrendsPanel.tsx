import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Loader, SimpleGrid, Stack, Text } from '@mantine/core';
import { BarChart, LineChart } from '@mantine/charts';
import { IconChartLine } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { StatCard } from '../../components/StatCard';
import { errorMessage } from '../../i18n/errors';
import { formatShortDate } from '../../i18n/format';
import { useVitals, type VitalsPoint } from './api';

const round1 = (n: number) => Math.round(n * 10) / 10;
const last = <T,>(rows: T[], pick: (r: T) => boolean): T | undefined => [...rows].reverse().find(pick);

/** Headline numbers: the latest weight (after the session, else before), the average weight loss and the latest BP. */
export function trendStats(points: VitalsPoint[]) {
  const w = last(points, (p) => p.weightAfter != null || p.weightBefore != null);
  const losses = points.map((p) => p.weightLoss).filter((x): x is number => x != null);
  const bp = last(points, (p) => p.systolic != null && p.diastolic != null);
  return {
    lastWeight: w ? (w.weightAfter ?? w.weightBefore)! : null,
    avgLoss: losses.length ? round1(losses.reduce((a, b) => a + b, 0) / losses.length) : null,
    lastBp: bp ? { systolic: bp.systolic!, diastolic: bp.diastolic! } : null,
  };
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padding="md">
      <Stack gap="sm">
        <Text fw={600}>{title}</Text>
        {/* recharts lays out left to right; Arabic reverses the time axis instead (see axis props) */}
        <div dir="ltr">{children}</div>
      </Stack>
    </Card>
  );
}

/** Weight and blood pressure across the patient's last sessions, for doctors. */
export function TrendsPanel({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation();
  const q = useVitals(patientId);
  if (q.isPending) return <Loader size="sm" />;
  if (q.isError) return <Alert color="danger">{errorMessage(t, q.error)}</Alert>;
  const points = q.data.points;
  if (points.length === 0)
    return <EmptyState icon={IconChartLine} title={t('doctor.trends.empty')} hint={t('doctor.trends.emptyHint')} />;

  const rtl = i18n.dir() === 'rtl';
  const stats = trendStats(points);
  const kg = (v: number | null) => (v == null ? '—' : t('doctor.trends.kg', { value: v }));
  const data = points.map((p) => ({ ...p, label: formatShortDate(p.date, i18n.language) }));
  const xAxisProps = { reversed: rtl, minTickGap: 12 };
  // Arabic: the value axis sits on the right, its labels pushed outwards (Mantine's default offset assumes the left)
  const yAxisProps = {
    orientation: rtl ? ('right' as const) : ('left' as const),
    width: 40,
    ...(rtl ? { tick: { transform: 'translate(10, 0)', fontSize: 12, fill: 'currentColor' } } : {}),
  };
  type Domain = [(n: number) => number, (n: number) => number];
  const tight = { ...yAxisProps, domain: [(min: number) => Math.floor(min - 1), (max: number) => Math.ceil(max + 1)] as Domain };
  // BP: round tens, evenly spaced ticks (recharts' own picks can skip one and look uneven)
  const bpValues = points.flatMap((p) => [p.systolic, p.diastolic]).filter((v): v is number => v != null);
  const bpLo = Math.floor((Math.min(...bpValues, 80) - 5) / 10) * 10;
  const bpHi = Math.ceil((Math.max(...bpValues, 120) + 5) / 10) * 10;
  const bpStep = (bpHi - bpLo) / 10 > 5 ? 20 : 10;
  const bpTicks = Array.from({ length: Math.floor((bpHi - bpLo) / bpStep) + 1 }, (_, i) => bpLo + i * bpStep);
  const tens = { ...yAxisProps, domain: [bpLo, bpTicks[bpTicks.length - 1]!] as [number, number], ticks: bpTicks, interval: 0 as const };
  const common = { h: 200, dataKey: 'label', xAxisProps, gridAxis: 'y' as const, tooltipAnimationDuration: 150 };

  return (
    <Stack gap="md" data-testid="trends">
      <Text size="sm" c="dimmed">
        {t('doctor.trends.subtitle', { count: points.length })}
      </Text>
      {/* three across even on phones: no icons, so the numbers keep their size */}
      <SimpleGrid cols={3} spacing="xs">
        <StatCard compact value={kg(stats.lastWeight)} label={t('doctor.trends.lastWeight')} />
        <StatCard compact value={kg(stats.avgLoss)} label={t('doctor.trends.avgLoss')} />
        <StatCard
          compact
          value={
            stats.lastBp ? (
              <bdi dir="ltr">
                {stats.lastBp.systolic}/{stats.lastBp.diastolic}
              </bdi>
            ) : (
              '—'
            )
          }
          label={t('doctor.trends.lastBp')}
        />
      </SimpleGrid>

      <ChartCard title={t('doctor.trends.weightTitle')}>
        <LineChart
          {...common}
          data={data}
          yAxisProps={tight}
          connectNulls
          withLegend
          legendProps={{ verticalAlign: 'bottom', height: 40 }}
          strokeWidth={2}
          series={[
            { name: 'weightBefore', label: t('doctor.trends.before'), color: 'var(--uoca-chart-gold)' },
            { name: 'weightAfter', label: t('doctor.trends.after'), color: 'var(--uoca-chart-blue)' },
          ]}
        />
      </ChartCard>

      <ChartCard title={t('doctor.trends.lossTitle')}>
        <BarChart
          {...common}
          data={data}
          yAxisProps={yAxisProps}
          barProps={{ radius: [4, 4, 0, 0] }}
          maxBarWidth={18}
          series={[{ name: 'weightLoss', label: t('doctor.trends.loss'), color: 'var(--uoca-chart-gold)' }]}
        />
      </ChartCard>

      <ChartCard title={t('doctor.trends.bpTitle')}>
        <LineChart
          {...common}
          data={data}
          yAxisProps={tens}
          connectNulls
          withLegend
          legendProps={{ verticalAlign: 'bottom', height: 40 }}
          strokeWidth={2}
          series={[
            { name: 'systolic', label: t('doctor.trends.systolic'), color: 'var(--uoca-chart-red)' },
            { name: 'diastolic', label: t('doctor.trends.diastolic'), color: 'var(--uoca-chart-blue)' },
          ]}
        />
      </ChartCard>
    </Stack>
  );
}
