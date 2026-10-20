import { useTranslation } from 'react-i18next';
import { Card, Group, SimpleGrid, Stack, ThemeIcon, Title } from '@mantine/core';
import { IconActivityHeartbeat, IconBuildingHospital, IconPackage, IconPill, IconUsers } from '@tabler/icons-react';
import { StatCard } from './StatCard';
import { DeltaText } from './stats/DeltaText';
import { UsageBars } from './stats/UsageBars';

export interface ItemTotal {
  item: { id: string; name: string };
  unit: string;
  total: number;
}
export interface CentreStats {
  centre: { id: string; name: string };
  sessions: number;
  patients: number;
  medicines: ItemTotal[];
  supplies: ItemTotal[];
}

/** Medicines and supplies of one month as bar lists, side by side from tablet width. */
export function UsageSection({ stats }: { stats: CentreStats }) {
  const { t } = useTranslation();
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
      <UsageBars title={t('pm.dashboard.medicines')} rows={stats.medicines} icon={IconPill} />
      <UsageBars title={t('pm.dashboard.supplies')} rows={stats.supplies} icon={IconPackage} />
    </SimpleGrid>
  );
}

/**
 * One centre's month: sessions and patients (with the change against `previous` when given) and the most used
 * medicines and supplies.
 */
export function StatsCard({ stats, previous, previousMonth }: { stats: CentreStats; previous?: CentreStats; previousMonth?: string }) {
  const { t } = useTranslation();
  const delta = (pick: (s: CentreStats) => number) =>
    previous && previousMonth ? <DeltaText current={pick(stats)} previous={pick(previous)} previousMonth={previousMonth} /> : undefined;
  return (
    <Card padding="md" data-centre-stats>
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap">
          <ThemeIcon variant="light" color="uoca" size={36} radius="md" aria-hidden>
            <IconBuildingHospital size={20} stroke={1.7} />
          </ThemeIcon>
          <Title order={3} size="h4" style={{ minWidth: 0 }}>
            {stats.centre.name}
          </Title>
        </Group>
        <SimpleGrid cols={2} spacing="sm">
          <StatCard
            flat
            compact
            value={stats.sessions}
            label={t('pm.dashboard.sessions')}
            icon={IconActivityHeartbeat}
            footer={delta((s) => s.sessions)}
          />
          <StatCard
            flat
            compact
            value={stats.patients}
            label={t('pm.dashboard.patients')}
            icon={IconUsers}
            footer={delta((s) => s.patients)}
          />
        </SimpleGrid>
        <UsageSection stats={stats} />
      </Stack>
    </Card>
  );
}
