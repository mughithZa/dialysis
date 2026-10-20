import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Group, Stack, Table, Text, ThemeIcon } from '@mantine/core';
import { IconChartBar, IconPackageOff, IconTable, type Icon } from '@tabler/icons-react';
import { EmptyState } from '../EmptyState';
import type { ItemTotal } from '../StatsCard';
import { usageBars } from './month';

const TOP = 5;

/** "375 cc": the amount and its unit kept together and in order in right-to-left text. */
const Amount = ({ total, unit }: { total: number; unit: string }) => (
  <Text span size="sm" fw={700} c="uoca.8" dir="auto" style={{ whiteSpace: 'nowrap', unicodeBidi: 'isolate' }}>
    {total} {unit}
  </Text>
);

/**
 * The most used medicines (or supplies) of a month as small horizontal bars. A bar is the item's share of the largest
 * amount in the same unit. "Show as table" lists every item with its total, for exact figures and screen readers.
 */
export function UsageBars({ title, rows, icon: IconCmp }: { title: string; rows: ItemTotal[]; icon: Icon }) {
  const { t } = useTranslation();
  const [table, setTable] = useState(false);
  const bars = usageBars(rows);
  const top = bars.slice(0, TOP);

  return (
    <Stack gap="xs" data-usage-bars>
      <Group justify="space-between" wrap="nowrap" gap="xs">
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color="uoca" size={28} radius="md" aria-hidden>
            <IconCmp size={16} stroke={1.8} />
          </ThemeIcon>
          <Text fw={600} truncate>
            {title}
          </Text>
        </Group>
        {rows.length > 0 && (
          <Button
            variant="subtle"
            size="compact-sm"
            mih={44}
            px={6}
            aria-expanded={table}
            aria-label={t(table ? 'stats.showBars' : 'stats.showTable', { title })}
            leftSection={table ? <IconChartBar size={16} /> : <IconTable size={16} />}
            onClick={() => setTable((v) => !v)}
          >
            {table ? t('stats.bars') : t('stats.table')}
          </Button>
        )}
      </Group>
      {rows.length === 0 ? (
        <EmptyState compact icon={IconPackageOff} title={t('pm.dashboard.noUsage')} />
      ) : table ? (
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
              {bars.map((r) => (
                <Table.Tr key={r.item.id}>
                  <Table.Td>{r.item.name}</Table.Td>
                  <Table.Td ta="end">{r.total}</Table.Td>
                  <Table.Td>{r.unit}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        <Stack gap={6}>
        <Stack gap={10} component="ul" m={0} p={0} style={{ listStyle: 'none' }}>
          {top.map((r) => (
            <li key={r.item.id} data-usage-bar={r.item.name}>
              <Group justify="space-between" wrap="nowrap" gap="xs" mb={4}>
                <Text size="sm" truncate>
                  {r.item.name}
                </Text>
                <Amount total={r.total} unit={r.unit} />
              </Group>
              <Box h={8} bg="uoca.1" style={{ borderRadius: 4, overflow: 'hidden' }} aria-hidden>
                <Box
                  h="100%"
                  style={{
                    inlineSize: `${Math.max(r.share * 100, r.total > 0 ? 3 : 0)}%`,
                    background: 'var(--uoca-chart-gold)',
                    borderRadius: 4,
                  }}
                />
              </Box>
            </li>
          ))}
        </Stack>
          {bars.length > TOP && (
            <Text size="xs" c="dimmed">
              {t('stats.moreItems', { count: bars.length - TOP })}
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}
