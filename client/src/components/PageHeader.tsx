import type { ReactNode } from 'react';
import { Group, Stack, Text, Title } from '@mantine/core';

/** A screen's title row: title, optional subtitle underneath, optional action on the end side. */
export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <Group justify="space-between" align="center" wrap="wrap" gap="sm">
      <Stack gap={2} style={{ minWidth: 0, flex: '1 1 auto' }}>
        <Title order={2}>{title}</Title>
        {subtitle && (
          <Text c="dimmed" size="sm">
            {subtitle}
          </Text>
        )}
      </Stack>
      {action}
    </Group>
  );
}
