import type { ReactNode } from 'react';
import { Card, Group, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';

/** One settings section: an icon, a title, a one-line hint and its fields. */
export function SectionCard({ icon: IconCmp, title, hint, children }: { icon: Icon; title: string; hint: string; children: ReactNode }) {
  return (
    <Card padding="md">
      <Stack gap="md">
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <ThemeIcon variant="light" color="uoca" size={40} radius="md" aria-hidden>
            <IconCmp size={22} stroke={1.7} />
          </ThemeIcon>
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Title order={3} size="h4">
              {title}
            </Title>
            <Text size="sm" c="dimmed">
              {hint}
            </Text>
          </Stack>
        </Group>
        {children}
      </Stack>
    </Card>
  );
}
