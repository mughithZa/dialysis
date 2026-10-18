import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Select, Stack, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { DISCHARGE_REASONS, useDischarge, type DischargeReason } from './api';
import { todayLocal } from './dates';

/** Discharge a patient. Mount with a `key` so each open starts fresh. */
export function DischargeDialog({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const discharge = useDischarge();
  const [reason, setReason] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocal());
  const valid = !!reason && /^\d{4}-\d{2}-\d{2}$/.test(date);

  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        discharge.mutate(
          { id: patientId, reason: reason as DischargeReason, date },
          {
            onSuccess: () => {
              notifications.show({ message: t('desk.discharge.done') });
              onDone();
            },
          },
        );
      }}
    >
      <Select
        label={t('desk.discharge.reason')}
        value={reason}
        onChange={setReason}
        data={DISCHARGE_REASONS.map((r) => ({ value: r, label: t(`desk.dischargeReason.${r}`) }))}
      />
      <TextInput label={t('desk.discharge.date')} type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
      {discharge.isError && <Alert color="danger">{errorMessage(t, discharge.error)}</Alert>}
      <Button type="submit" mih={44} color="danger" loading={discharge.isPending} disabled={!valid}>
        {t('desk.discharge.confirm')}
      </Button>
    </Stack>
  );
}
