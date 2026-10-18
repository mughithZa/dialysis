import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Chip, Group, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useBookPattern, usePatients, type GridDto } from './api';
import { todayLocal, WEEKDAYS } from './dates';

export interface BookInitial {
  chairId: string | null;
  shiftId: string | null;
  weekday: number | null;
  /** Fixed patient (booking from the patient page); otherwise chosen in the dialog. */
  patientId?: string;
}

interface Props {
  grid: GridDto;
  initial: BookInitial;
  onDone: () => void;
}

/** Book (or change) a patient's weekly pattern. Mount with a `key` so each open starts from `initial`. */
export function BookDialog({ grid, initial, onDone }: Props) {
  const { t } = useTranslation();
  const book = useBookPattern();
  const patients = usePatients('', 'active');
  const [patientId, setPatientId] = useState<string | null>(initial.patientId ?? null);
  const [chairId, setChairId] = useState<string | null>(initial.chairId);
  const [shiftId, setShiftId] = useState<string | null>(initial.shiftId);
  const [weekdays, setWeekdays] = useState<string[]>(initial.weekday === null ? [] : [String(initial.weekday)]);
  const [from, setFrom] = useState(todayLocal());

  // A patient who already has slots on the grid is changing their pattern, not booking a new one.
  const change = patientId !== null && grid.slots.some((s) => s.patient.id === patientId);
  const valid = !!patientId && !!chairId && !!shiftId && weekdays.length >= 1 && weekdays.length <= 3 && /^\d{4}-\d{2}-\d{2}$/.test(from);

  const submit = () => {
    if (!valid) return;
    book.mutate(
      { patientId, change, chairId, shiftId, weekdays: weekdays.map(Number).sort(), from },
      {
        onSuccess: () => {
          notifications.show({ message: t(change ? 'desk.book.changed' : 'desk.book.booked') });
          onDone();
        },
      },
    );
  };

  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        submit();
      }}
    >
      <Select
        label={t('desk.book.patient')}
        searchable
        value={patientId}
        onChange={setPatientId}
        disabled={initial.patientId !== undefined}
        data={(patients.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
      />
      <Select
        label={t('desk.book.chair')}
        value={chairId}
        onChange={setChairId}
        data={grid.chairs.filter((c) => c.active || c.id === chairId).map((c) => ({ value: c.id, label: c.label }))}
      />
      <Select
        label={t('desk.book.shift')}
        value={shiftId}
        onChange={setShiftId}
        data={grid.shifts.filter((s) => s.active || s.id === shiftId).map((s) => ({ value: s.id, label: s.name }))}
      />
      <Stack gap={4}>
        <Text size="sm" fw={500}>
          {t('desk.book.weekdays')}
        </Text>
        <Chip.Group multiple value={weekdays} onChange={setWeekdays}>
          <Group gap="xs">
            {WEEKDAYS.map((d) => (
              <Chip key={d} value={String(d)} size="md">
                {t(`desk.weekdays.${d}`)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Text size="xs" c="dimmed">
          {t('desk.book.weekdaysHint')}
        </Text>
      </Stack>
      <TextInput label={t('desk.book.from')} type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
      {book.isError && <Alert color="danger">{errorMessage(t, book.error)}</Alert>}
      <Button type="submit" mih={44} loading={book.isPending} disabled={!valid}>
        {change ? t('desk.book.change') : t('desk.book.book')}
      </Button>
    </Stack>
  );
}
