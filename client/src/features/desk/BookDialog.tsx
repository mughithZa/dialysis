import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionIcon, Alert, Button, Card, Group, Loader, Select, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useBookPlan, useChangePlan, useFreeMachines, usePatients, useSetup, type PlanItem, type SetupDto } from './api';
import { parseLocal, shiftDate, todayLocal } from './dates';
import { WEEKDAY_ORDER } from './weekdays';

export interface BookInitial {
  /** Fixed patient (booking from the patient page); otherwise chosen in the dialog. */
  patientId?: string;
  /** The start date (YYYY-MM-DD); defaults to today. */
  date?: string;
  /** Prefilled day rows (an empty-cell click, or the current plan when changing it). */
  items?: PlanItem[];
}

interface Props {
  /** `book` creates a plan; `change` replaces the weekly plan from the start date. */
  mode?: 'book' | 'change';
  initial?: BookInitial;
  onDone: () => void;
}

interface Row {
  id: number;
  weekday: string | null;
  shiftId: string | null;
  chairId: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** First date on or after `from` that falls on `weekday` (0 = Sunday). */
function firstOnOrAfter(from: string, weekday: number): string {
  return shiftDate(from, (weekday - parseLocal(from).getDay() + 7) % 7);
}

interface DayRowProps {
  row: Row;
  index: number;
  from: string;
  patientId: string | undefined;
  setup: SetupDto;
  duplicate: boolean;
  removable: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}

function DayRow({ row, index, from, patientId, setup, duplicate, removable, onChange, onRemove }: DayRowProps) {
  const { t } = useTranslation();
  const date = row.weekday !== null && DATE.test(from) ? firstOnOrAfter(from, Number(row.weekday)) : '';
  const free = useFreeMachines(date, row.shiftId, patientId);

  // A machine that is no longer in the free list (taken meanwhile) is cleared so it cannot be submitted.
  useEffect(() => {
    if (row.chairId && free.data && !free.isFetching && !free.data.some((m) => m.id === row.chairId)) onChange({ chairId: null });
  });

  const days = WEEKDAY_ORDER.filter((d) => setup.workingDays.includes(d) || String(d) === row.weekday);
  return (
    <Card withBorder padding="xs" role="group" aria-label={t('desk.book.dayN', { n: index + 1 })}>
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600}>{t('desk.book.dayN', { n: index + 1 })}</Text>
          {removable && (
            <ActionIcon variant="subtle" color="danger" size={44} aria-label={t('desk.book.removeDay', { n: index + 1 })} onClick={onRemove}>
              ×
            </ActionIcon>
          )}
        </Group>
        <Select
          label={t('desk.book.weekday')}
          value={row.weekday}
          onChange={(v) => onChange({ weekday: v, chairId: null })}
          data={days.map((d) => ({ value: String(d), label: t(`desk.weekdays.${d}`) }))}
        />
        <Select
          label={t('desk.book.block')}
          value={row.shiftId}
          onChange={(v) => onChange({ shiftId: v, chairId: null })}
          data={setup.blocks.map((b) => ({ value: b.id, label: b.name }))}
        />
        <Select
          label={t('desk.book.machine')}
          value={row.chairId}
          onChange={(v) => onChange({ chairId: v })}
          disabled={!date || !row.shiftId}
          rightSection={free.isFetching ? <Loader size="xs" /> : undefined}
          nothingFoundMessage={free.isSuccess ? t('desk.book.noFree') : undefined}
          data={(free.data ?? []).map((m) => ({ value: m.id, label: t('desk.calendar.machine', { label: m.label }) }))}
        />
        {free.isError && <Alert color="danger">{errorMessage(t, free.error)}</Alert>}
        {duplicate && <Alert color="danger">{t('desk.book.duplicate')}</Alert>}
      </Stack>
    </Card>
  );
}

let nextRowId = 1;
const newRow = (item?: PlanItem): Row => ({
  id: nextRowId++,
  weekday: item ? String(item.weekday) : null,
  shiftId: item?.shiftId ?? null,
  chairId: item?.chairId ?? null,
});

/** Book a patient's sessions as day rows, or change their weekly plan from a date. Mount with a `key` so each open starts from `initial`. */
export function BookDialog({ mode = 'book', initial = {}, onDone }: Props) {
  const { t } = useTranslation();
  const change = mode === 'change';
  const setup = useSetup();
  const book = useBookPlan();
  const changePlan = useChangePlan();
  const save = change ? changePlan : book;
  const patients = usePatients('', 'active');
  const [patientId, setPatientId] = useState<string | null>(initial.patientId ?? null);
  const [rows, setRows] = useState<Row[]>(() => (initial.items?.length ? initial.items.map(newRow) : [newRow()]));
  const [from, setFrom] = useState(initial.date ?? todayLocal());
  const [repeat, setRepeat] = useState<'once' | 'weekly'>('weekly');
  const [ending, setEnding] = useState<'none' | 'date'>('none');
  const [until, setUntil] = useState('');

  const weekly = change || repeat === 'weekly';
  const keys = rows.map((r) => (r.weekday !== null && r.shiftId ? `${r.weekday}:${r.shiftId}` : null));
  const duplicateAt = (i: number) => keys[i] !== null && keys.some((k, j) => j !== i && k === keys[i]);
  const hasDuplicate = keys.some((_, i) => duplicateAt(i));
  const complete = rows.every((r) => r.weekday !== null && r.shiftId && r.chairId);
  const untilOk = !weekly || ending === 'none' || (DATE.test(until) && until >= from);
  const valid = !!patientId && complete && !hasDuplicate && DATE.test(from) && from >= todayLocal() && untilOk;

  const patch = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const submit = () => {
    if (!valid || !patientId) return;
    const items = rows.map((r) => ({ weekday: Number(r.weekday), shiftId: r.shiftId!, chairId: r.chairId! }));
    const to = weekly && ending === 'date' ? until : null;
    const done = {
      onSuccess: () => {
        notifications.show({ message: t(change ? 'desk.book.changed' : 'desk.book.booked') });
        onDone();
      },
    };
    if (change) changePlan.mutate({ patientId, items, from, to }, done);
    else book.mutate({ patientId, items, from, repeat, ...(repeat === 'weekly' ? { to } : {}) }, done);
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
      {setup.isPending && <Loader size="sm" />}
      {setup.isError && <Alert color="danger">{errorMessage(t, setup.error)}</Alert>}
      {setup.data &&
        rows.map((r, i) => (
          <DayRow
            key={r.id}
            row={r}
            index={i}
            from={from}
            patientId={patientId ?? undefined}
            setup={setup.data}
            duplicate={duplicateAt(i)}
            removable={rows.length > 1}
            onChange={(p) => patch(r.id, p)}
            onRemove={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
          />
        ))}
      <Button variant="default" mih={44} disabled={rows.length >= 7} onClick={() => setRows((rs) => [...rs, newRow()])}>
        {t('desk.book.addDay')}
      </Button>
      <TextInput label={t('desk.book.from')} type="date" min={todayLocal()} value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
      {!change && (
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            {t('desk.book.repeat')}
          </Text>
          <SegmentedControl
            fullWidth
            value={repeat}
            onChange={(v) => setRepeat(v as 'once' | 'weekly')}
            data={[
              { value: 'once', label: t('desk.book.repeatOnce') },
              { value: 'weekly', label: t('desk.book.repeatWeekly') },
            ]}
          />
        </Stack>
      )}
      {weekly && (
        <Stack gap="xs">
          <SegmentedControl
            fullWidth
            value={ending}
            onChange={(v) => setEnding(v as 'none' | 'date')}
            data={[
              { value: 'none', label: t('desk.book.noEnd') },
              { value: 'date', label: t('desk.book.endOn') },
            ]}
          />
          {ending === 'date' && <TextInput label={t('desk.book.until')} type="date" min={from} value={until} onChange={(e) => setUntil(e.currentTarget.value)} />}
        </Stack>
      )}
      {save.isError && <Alert color="danger">{errorMessage(t, save.error)}</Alert>}
      <Button type="submit" mih={44} loading={save.isPending} disabled={!valid}>
        {change ? t('desk.book.change') : t('desk.book.book')}
      </Button>
    </Stack>
  );
}
