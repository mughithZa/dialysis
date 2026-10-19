import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionIcon, Alert, Button, Divider, Group, Menu, Modal, Stack, Text, Textarea } from '@mantine/core';
import { IconDots, IconNote, IconPencil, IconTrash } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
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
    <Stack gap="xs" data-note>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Text size="xs" c="dimmed">
            {timeOf(note.at)} · {note.by.name}
          </Text>
          <Text dir="auto" style={{ overflowWrap: 'anywhere' }}>{note.text}</Text>
        </Stack>
        {canEdit && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="uoca" size={44} aria-label={t('nurse.notes.menu')} loading={remove.isPending}>
                <IconDots size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                mih={44}
                leftSection={<IconPencil size={16} />}
                onClick={() => {
                  setText(note.text);
                  setEditing(true);
                }}
              >
                {t('nurse.notes.edit')}
              </Menu.Item>
              <Menu.Item
                mih={44}
                color="danger"
                leftSection={<IconTrash size={16} />}
                onClick={() => remove.mutate(note.id, { onSuccess: () => notifications.show({ message: t('nurse.notes.removed') }) })}
              >
                {t('nurse.notes.remove')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
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
      {session.notes.length === 0 && <EmptyState compact icon={IconNote} title={t('nurse.notes.none')} />}
      {session.notes.map((n, i) => (
        <Fragment key={n.id}>
          {i > 0 && <Divider color="var(--uoca-border)" />}
          <NoteRow sessionId={session.id} note={n} canEdit={canEdit} />
        </Fragment>
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
