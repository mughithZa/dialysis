import { useTranslation } from 'react-i18next';
import { Badge, type BadgeProps } from '@mantine/core';
import { STATUS_TONES, type StatusTone } from '../theme';

export type BadgeStatus = StatusTone;

/**
 * A session's status as a coloured pill: one look per status (see `STATUS_TONES` in theme.ts), label from
 * `sessions.status.*`. `waiting` is the board's "booked today, not started yet".
 */
export function StatusBadge({ status, ...rest }: { status: BadgeStatus } & Omit<BadgeProps, 'color' | 'variant' | 'children'>) {
  const { t } = useTranslation();
  const tone = STATUS_TONES[status];
  return (
    <Badge
      variant="filled"
      bg={tone.bg}
      c={tone.fg}
      td={tone.strike ? 'line-through' : undefined}
      data-status={status}
      style={{ flexShrink: 0 }}
      {...rest}
    >
      {t(`sessions.status.${status}`)}
    </Badge>
  );
}
