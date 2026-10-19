import type { ReactNode } from 'react';
import { Button, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconInbox, type Icon } from '@tabler/icons-react';

export interface EmptyStateProps {
  title: string;
  /** One line telling the user what will appear here or what to do next. */
  hint?: string;
  icon?: Icon;
  /** Optional call to action, e.g. "Add patient". */
  action?: { label: string; onClick: () => void; icon?: Icon };
  /** Small inline version for lists inside a card. */
  compact?: boolean;
  children?: ReactNode;
}

/** What a list shows when it has nothing in it: an icon, a short title, a hint and maybe an action. */
export function EmptyState({ title, hint, icon: IconCmp = IconInbox, action, compact, children }: EmptyStateProps) {
  const ActionIconCmp = action?.icon;
  return (
    <Stack
      align="center"
      gap={compact ? 4 : 'xs'}
      py={compact ? 'sm' : 'lg'}
      px="md"
      ta="center"
      data-empty-state
      style={compact ? undefined : { border: '1px dashed var(--uoca-border-strong)', borderRadius: 'var(--mantine-radius-lg)' }}
    >
      <ThemeIcon variant="light" color="uoca" size={compact ? 36 : 48} radius="xl" aria-hidden>
        <IconCmp size={compact ? 20 : 26} stroke={1.6} />
      </ThemeIcon>
      <Text fw={600} size={compact ? 'sm' : 'md'}>
        {title}
      </Text>
      {hint && (
        <Text size="sm" c="dimmed" maw={360}>
          {hint}
        </Text>
      )}
      {children}
      {action && (
        <Button mt="xs" mih={44} onClick={action.onClick} leftSection={ActionIconCmp ? <ActionIconCmp size={18} /> : undefined}>
          {action.label}
        </Button>
      )}
    </Stack>
  );
}
