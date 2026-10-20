import { Badge, type BadgeProps } from '@mantine/core';
import { STATE_TONES, type StateTone } from '../theme';

/**
 * An admin record's state as a pill in the status-badge style: on (active, approved), waiting (pending review),
 * off (closed, inactive) or info (scope tags such as "Global").
 */
export function StateChip({ tone, children, ...rest }: { tone: StateTone; children: string } & Omit<BadgeProps, 'color' | 'variant' | 'children'>) {
  const c = STATE_TONES[tone];
  return (
    <Badge variant="filled" bg={c.bg} c={c.fg} data-state={tone} style={{ flexShrink: 0 }} {...rest}>
      {children}
    </Badge>
  );
}
