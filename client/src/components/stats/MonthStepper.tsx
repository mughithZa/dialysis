import { useTranslation } from 'react-i18next';
import { ActionIcon, Group, Text } from '@mantine/core';
import { IconCalendarMonth, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import classes from './MonthStepper.module.css';
import { formatMonth } from '../../i18n/format';
import { currentMonth, shiftMonth } from './month';

/** A compact month control: previous / month name / next (no months after this one). */
export function MonthStepper({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.dir() === 'rtl';
  // chevrons point the way the reading direction goes
  const Prev = rtl ? IconChevronRight : IconChevronLeft;
  const Next = rtl ? IconChevronLeft : IconChevronRight;
  const atNow = value >= currentMonth();
  return (
    <Group
      gap={4}
      wrap="nowrap"
      role="group"
      aria-label={t('pm.dashboard.month')}
      data-month-stepper
      style={{
        border: '1px solid var(--uoca-border)',
        borderRadius: 'var(--mantine-radius-xl)',
        background: 'var(--uoca-surface)',
        paddingInline: 2,
        width: 'fit-content',
      }}
    >
      <ActionIcon variant="subtle" size={44} radius="xl" className={classes.step} aria-label={t('stats.prevMonth')} onClick={() => onChange(shiftMonth(value, -1))}>
        <Prev size={20} />
      </ActionIcon>
      <Group gap={6} wrap="nowrap" miw={150} justify="center">
        <IconCalendarMonth size={18} aria-hidden color="var(--mantine-color-uoca-5)" />
        <Text fw={600} aria-live="polite" data-month-label>
          {formatMonth(value, i18n.language)}
        </Text>
      </Group>
      <ActionIcon
        variant="subtle"
        size={44}
        radius="xl"
        className={classes.step}
        aria-label={t('stats.nextMonth')}
        disabled={atNow}
        onClick={() => onChange(shiftMonth(value, 1))}
      >
        <Next size={20} />
      </ActionIcon>
    </Group>
  );
}
