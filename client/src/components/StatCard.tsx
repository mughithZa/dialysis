import type { ReactNode } from 'react';
import { Card, Group, Stack, Text, ThemeIcon, type MantineColor } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';

/** One big number with its label, e.g. "12 sessions this month". */
export function StatCard({
  value,
  label,
  icon: IconCmp,
  color = 'uoca',
}: {
  value: ReactNode;
  label: string;
  icon?: Icon;
  color?: MantineColor;
}) {
  return (
    <Card padding="sm" data-stat-card>
      <Group gap="sm" wrap="nowrap" align="center">
        {IconCmp && (
          <ThemeIcon variant="light" color={color} size={40} radius="md" aria-hidden>
            <IconCmp size={22} stroke={1.7} />
          </ThemeIcon>
        )}
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text fz={26} fw={700} lh={1.15} c={`${color}.7`}>
            {value}
          </Text>
          <Text size="sm" c="dimmed" lineClamp={2}>
            {label}
          </Text>
        </Stack>
      </Group>
    </Card>
  );
}
