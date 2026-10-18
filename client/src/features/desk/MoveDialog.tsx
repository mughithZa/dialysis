import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Loader, Select, Stack, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useFreeMachines, useMoveSession, useSetup } from './api';
import { todayLocal } from './dates';

/** Move one scheduled session to another date, block and free machine. Mount with a `key` so each open starts fresh. */
export function MoveDialog({ sessionId, date: current, onDone }: { sessionId: string; date: string; onDone: () => void }) {
  const { t } = useTranslation();
  const setup = useSetup();
  const move = useMoveSession();
  const [date, setDate] = useState(current < todayLocal() ? todayLocal() : current);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [chairId, setChairId] = useState<string | null>(null);
  const free = useFreeMachines(date, shiftId);
  const valid = !!shiftId && !!chairId && date >= todayLocal();

  // A machine that is no longer free (taken meanwhile) is cleared so it cannot be submitted.
  useEffect(() => {
    if (chairId && free.data && !free.isFetching && !free.data.some((m) => m.id === chairId)) setChairId(null);
  }, [chairId, free.data, free.isFetching]);

  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        move.mutate(
          { sessionId, date, shiftId, chairId },
          {
            onSuccess: () => {
              notifications.show({ message: t('desk.move.done') });
              onDone();
            },
          },
        );
      }}
    >
      {setup.isPending && <Loader size="sm" />}
      {setup.isError && <Alert color="danger">{errorMessage(t, setup.error)}</Alert>}
      <TextInput
        label={t('desk.move.date')}
        type="date"
        min={todayLocal()}
        value={date}
        onChange={(e) => {
          setDate(e.currentTarget.value);
          setChairId(null);
        }}
      />
      <Select
        label={t('desk.move.block')}
        value={shiftId}
        onChange={(v) => {
          setShiftId(v);
          setChairId(null);
        }}
        data={(setup.data?.blocks ?? []).map((b) => ({ value: b.id, label: b.name }))}
      />
      <Select
        label={t('desk.move.machine')}
        value={chairId}
        onChange={setChairId}
        disabled={!shiftId}
        nothingFoundMessage={free.isSuccess ? t('desk.book.noFree') : undefined}
        data={(free.data ?? []).map((m) => ({ value: m.id, label: t('desk.calendar.machine', { label: m.label }) }))}
      />
      {free.isError && <Alert color="danger">{errorMessage(t, free.error)}</Alert>}
      {move.isError && <Alert color="danger">{errorMessage(t, move.error)}</Alert>}
      <Button type="submit" mih={44} loading={move.isPending} disabled={!valid}>
        {t('desk.move.move')}
      </Button>
    </Stack>
  );
}
