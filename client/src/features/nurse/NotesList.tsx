import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Group, Modal, Stack, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useAddNote, useRemoveNote, useUpdateNote, type NoteDto, type SessionDetail } from './api';
import { timeOf } from './VitalsForm';

function NoteRow({ sessionId, note, canEdit }: { sessionId: string; note: NoteDto; canEdit: boolean }) {
  const { t } = useTranslation();
  const update = useUpdateNote(sessionId);
  const remove = useRemoveNote(sessionId);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  return (
    <Stack gap="xs">
      <Stack gap={0}>
        <Text size="xs" c="dimmed">
          {timeOf(note.at)} · {note.by.name}
        </Text>
        <Text>{note.text}</Text>
      </Stack>
      {canEdit && (
        <Group gap="xs">
          <Button
            mih={44}
            variant="default"
            onClick={() => {
              setText(note.text);
              setEditing(true);
            }}
          >
            {t('nurse.notes.edit')}
          </Button>
          <Button
            mih={44}
            variant="default"
            color="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate(note.id, { onSuccess: () => notifications.show({ message: t('nurse.notes.removed') }) })}
          >
            {t('nurse.notes.remove')}
          </Button>
        </Group>
      )}
      {remove.isError && <Alert color="danger">{errorMessage(t, remove.error)}</Alert>}
      <Modal opened={editing} onClose={() => setEditing(false)} title={t('nurse.notes.edit')}>
        <Stack gap="sm">
          <Textarea label={t('nurse.notes.add')} autosize minRows={3} value={text} onChange={(e) => setText(e.currentTarget.value)} />
          {update.isError && <Alert color="danger">{errorMessage(t, update.error)}</Alert>}
          <Button
            mih={44}
            disabled={text.trim() === ''}
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { noteId: note.id, text: text.trim() },
                {
                  onSuccess: () => {
                    notifications.show({ message: t('nurse.notes.updated') });
                    setEditing(false);
                  },
                },
              )
            }
          >
            {t('nurse.notes.saveEdit')}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

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
        <NoteRow key={n.id} sessionId={session.id} note={n} canEdit={canEdit} />
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
