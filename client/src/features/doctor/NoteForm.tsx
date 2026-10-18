import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useCreateNote } from './api';

/** Write a patient-level doctor note (not tied to a session). */
export function NoteForm({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const create = useCreateNote(patientId);
  const [text, setText] = useState('');
  const valid = text.trim().length > 0;

  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        create.mutate(text.trim(), {
          onSuccess: () => {
            setText('');
            notifications.show({ message: t('doctor.notes.added') });
          },
        });
      }}
    >
      <Textarea label={t('doctor.notes.text')} value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={2} maxLength={2000} />
      {create.isError && <Alert color="danger">{errorMessage(t, create.error)}</Alert>}
      <Button type="submit" mih={44} disabled={!valid} loading={create.isPending}>
        {t('doctor.notes.add')}
      </Button>
    </Stack>
  );
}
