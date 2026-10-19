import { useTranslation } from 'react-i18next';
import { Badge, type BadgeProps } from '@mantine/core';
import { PATIENT_STATUS_TONES, STATUS_TONES, type StatusTone } from '../theme';

export type BadgeStatus = StatusTone;
export type PatientBadgeStatus = keyof typeof PATIENT_STATUS_TONES;

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

/** A patient's status (active / transferring / discharged) in the same pill style. */
export function PatientStatusBadge({ status, ...rest }: { status: PatientBadgeStatus } & Omit<BadgeProps, 'color' | 'variant' | 'children'>) {
  const { t } = useTranslation();
  const tone = PATIENT_STATUS_TONES[status];
  return (
    <Badge variant="filled" bg={tone.bg} c={tone.fg} data-patient-status={status} style={{ flexShrink: 0 }} {...rest}>
      {t(`desk.patients.status.${status}`)}
    </Badge>
  );
}
