import { useTranslation } from 'react-i18next';
import { Card, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { StatCard } from './StatCard';
import { IconActivityHeartbeat, IconPackageOff, IconUsers } from '@tabler/icons-react';
import { EmptyState } from './EmptyState';

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

function TotalsTable({ title, rows }: { title: string; rows: ItemTotal[] }) {
  const { t } = useTranslation();
  return (
    <Stack gap={4}>
      <Text fw={600}>{title}</Text>
      {rows.length === 0 ? (
        <EmptyState compact icon={IconPackageOff} title={t('pm.dashboard.noUsage')} />
      ) : (
        <Table.ScrollContainer minWidth={0}>
          <Table verticalSpacing={6} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('pm.dashboard.item')}</Table.Th>
                <Table.Th ta="end">{t('common.total')}</Table.Th>
                <Table.Th>{t('common.unit')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.item.id}>
                  <Table.Td>{r.item.name}</Table.Td>
                  <Table.Td ta="end">{r.total}</Table.Td>
                  <Table.Td>{r.unit}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}

/** One centre's month: session and patient counts plus medicine and supply totals. */
export function StatsCard({ stats }: { stats: CentreStats }) {
  const { t } = useTranslation();
  return (
    <Card withBorder padding="md" data-centre-stats>
      <Stack gap="sm">
        <Title order={3} size="h4">
          {stats.centre.name}
        </Title>
        <SimpleGrid cols={2} spacing="sm">
          <StatCard value={stats.sessions} label={t('pm.dashboard.sessions')} icon={IconActivityHeartbeat} />
          <StatCard value={stats.patients} label={t('pm.dashboard.patients')} icon={IconUsers} />
        </SimpleGrid>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <TotalsTable title={t('pm.dashboard.medicines')} rows={stats.medicines} />
          <TotalsTable title={t('pm.dashboard.supplies')} rows={stats.supplies} />
        </SimpleGrid>
      </Stack>
    </Card>
  );
}
