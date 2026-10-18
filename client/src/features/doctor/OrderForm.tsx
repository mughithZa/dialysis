import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Textarea, TextInput } from '@mantine/core';
import { errorMessage } from '../../i18n/errors';
import { useCreateOrder } from './api';

/** Write a free-text doctor order for a patient. */
export function OrderForm({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const create = useCreateOrder(patientId);
  const [text, setText] = useState('');
  const [from, setFrom] = useState('');
  const valid = text.trim().length > 0;

  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        create.mutate(
          { text: text.trim(), ...(from ? { from } : {}) },
          {
            onSuccess: () => {
              setText('');
              setFrom('');
            },
          },
        );
      }}
    >
      <Textarea label={t('doctor.orders.text')} value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={2} maxLength={2000} />
      <TextInput label={t('doctor.orders.from')} type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
      {create.isError && <Alert color="danger">{errorMessage(t, create.error)}</Alert>}
      <Button type="submit" mih={44} disabled={!valid} loading={create.isPending}>
        {t('doctor.orders.add')}
      </Button>
    </Stack>
  );
}
