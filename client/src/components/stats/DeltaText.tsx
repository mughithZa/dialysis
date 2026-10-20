import { useTranslation } from 'react-i18next';
import { Group, Text, VisuallyHidden } from '@mantine/core';
import { IconArrowDown, IconArrowUp, IconEqual } from '@tabler/icons-react';
import { formatMonthName } from '../../i18n/format';
import { delta } from './month';

/**
 * The change against the previous month, e.g. "↑ +12 (+18%) vs September". Up is green, down is red, no change is
 * muted; the arrow and the sign carry the meaning too, never the colour alone.
 */
export function DeltaText({
  current,
  previous,
  previousMonth,
  hideMonth,
}: {
  current: number;
  previous: number;
  previousMonth: string;
  /** Leave out "vs September" where the month is already named (a table column). */
  hideMonth?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const d = delta(current, previous);
  const dir = d.diff > 0 ? 'up' : d.diff < 0 ? 'down' : 'same';
  const ArrowIcon = dir === 'up' ? IconArrowUp : dir === 'down' ? IconArrowDown : IconEqual;
  const color = dir === 'up' ? 'success.7' : dir === 'down' ? 'danger.6' : 'dimmed';
  const signed = `${d.diff > 0 ? '+' : d.diff < 0 ? '−' : ''}${Math.abs(d.diff)}`;
  const pct = d.pct == null || d.diff === 0 ? '' : ` (${d.pct > 0 ? '+' : '−'}${Math.abs(d.pct)}%)`;
  const month = formatMonthName(previousMonth, i18n.language);
  return (
    <Group gap={4} wrap="wrap" style={{ rowGap: 0 }} data-delta={dir}>
      <VisuallyHidden>{t(`stats.delta.${dir}`, { count: Math.abs(d.diff), month })}</VisuallyHidden>
      <Text span c={color} lh={1} style={{ display: 'inline-flex' }} aria-hidden>
        <ArrowIcon size={14} stroke={2.2} />
      </Text>
      <Text span size="xs" fw={700} c={color} style={{ whiteSpace: 'nowrap' }} aria-hidden>
        <bdi dir="ltr" data-delta-value>
          {signed}
          {pct}
        </bdi>
      </Text>
      {!hideMonth && (
        <Text span size="xs" c="dimmed" aria-hidden>
          {t('stats.vs', { month })}
        </Text>
      )}
    </Group>
  );
}
