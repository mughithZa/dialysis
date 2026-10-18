import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Loader, Select, Stack, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useGrid, useMakeup } from './api';
import { todayLocal } from './dates';

/** Book a one-off make-up session. Mount with a `key` so each open starts fresh. */
export function MakeupDialog({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const grid = useGrid();
  const makeup = useMakeup();
  const [date, setDate] = useState(todayLocal());
  const [chairId, setChairId] = useState<string | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const valid = !!chairId && !!shiftId && /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        makeup.mutate(
          { patientId, date, chairId, shiftId },
          {
            onSuccess: () => {
              notifications.show({ message: t('desk.makeup.booked') });
              onDone();
            },
          },
        );
      }}
    >
      {grid.isPending && <Loader size="sm" />}
      {grid.isError && <Alert color="danger">{errorMessage(t, grid.error)}</Alert>}
      <TextInput label={t('desk.makeup.date')} type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
      <Select
        label={t('desk.makeup.chair')}
        value={chairId}
        onChange={setChairId}
        data={(grid.data?.chairs ?? []).filter((c) => c.active).map((c) => ({ value: c.id, label: c.label }))}
      />
      <Select
        label={t('desk.makeup.shift')}
        value={shiftId}
        onChange={setShiftId}
        data={(grid.data?.shifts ?? []).filter((s) => s.active).map((s) => ({ value: s.id, label: `${s.name} (${s.start}-${s.end})` }))}
      />
      {makeup.isError && <Alert color="danger">{errorMessage(t, makeup.error)}</Alert>}
      <Button type="submit" mih={44} loading={makeup.isPending} disabled={!valid}>
        {t('desk.makeup.book')}
      </Button>
    </Stack>
  );
}
