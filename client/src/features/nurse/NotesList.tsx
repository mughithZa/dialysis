import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useAddNote, type SessionDetail } from './api';
import { timeOf } from './VitalsForm';

/** Timed notes with an add box (hidden when `canEdit` is false). */
export function NotesList({ session, canEdit }: { session: SessionDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const addNote = useAddNote(session.id);
  const [text, setText] = useState('');
  return (
    <Stack gap="sm">
      <Title order={4}>{t('nurse.notes.title')}</Title>
      {session.notes.length === 0 && <Text c="dimmed">{t('nurse.notes.none')}</Text>}
      {session.notes.map((n) => (
        <Stack key={n.id} gap={0}>
          <Text size="xs" c="dimmed">
            {timeOf(n.at)} · {n.by.name}
          </Text>
          <Text>{n.text}</Text>
        </Stack>
      ))}
      {canEdit && (
        <Stack gap="xs">
          <Textarea label={t('nurse.notes.add')} autosize minRows={2} value={text} onChange={(e) => setText(e.currentTarget.value)} />
          <Button
            mih={44}
            disabled={text.trim() === ''}
            loading={addNote.isPending}
            onClick={() =>
              addNote.mutate(text.trim(), {
                onSuccess: () => {
                  setText('');
                  notifications.show({ message: t('nurse.notes.added') });
                },
              })
            }
          >
            {t('nurse.notes.save')}
          </Button>
          {addNote.isError && <Alert color="danger">{errorMessage(t, addNote.error)}</Alert>}
        </Stack>
      )}
    </Stack>
  );
}
