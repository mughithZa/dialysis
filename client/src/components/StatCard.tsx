import type { ReactNode } from 'react';
import { Card, Group, Stack, Text, ThemeIcon, type MantineColor } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';

/** One big number with its label, e.g. "12 sessions this month". */
export function StatCard({
  value,
  label,
  icon: IconCmp,
  color = 'uoca',
  compact,
  footer,
  flat,
}: {
  value: ReactNode;
  label: string;
  icon?: Icon;
  color?: MantineColor;
  /** Smaller number, for three cards side by side on a phone. */
  compact?: boolean;
  /** A small line under the label, e.g. the change against last month. */
  footer?: ReactNode;
  /** A borderless sand tile, for figures inside another card. */
  flat?: boolean;
}) {
  return (
    <Card
      padding="sm"
      h="100%"
      data-stat-card
      withBorder={!flat}
      shadow={flat ? 'none' : undefined}
      radius={flat ? 'md' : undefined}
      styles={flat ? { root: { backgroundColor: 'var(--mantine-color-uoca-0)', border: 0 } } : undefined}
    >
      <Group gap="sm" wrap="nowrap" align="center">
        {IconCmp && (
          <ThemeIcon variant="light" color={color} size={40} radius="md" aria-hidden>
            <IconCmp size={22} stroke={1.7} />
          </ThemeIcon>
        )}
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text fz={compact ? 20 : 26} fw={700} style={compact ? { whiteSpace: 'nowrap' } : undefined} lh={1.15} c={`${color}.7`}>
            {value}
          </Text>
          <Text size="sm" c="dimmed" lineClamp={2}>
            {label}
          </Text>
          {footer}
        </Stack>
      </Group>
    </Card>
  );
}
