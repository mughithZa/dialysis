import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, Modal, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useCentreId } from '../centre/api';
import { todayLocal } from '../desk/dates';
import { hasHeparin, useRemoveUsage, useSession, useSessionAction, useUpdateUsage, type SessionDetail, type UsageLineDto } from './api';
import { HistoryDrawer } from './HistoryDrawer';
import { NotesList } from './NotesList';
import { AmountForm, UsagePicker } from './UsagePicker';
import { VitalsForm } from './VitalsForm';

function UsageRow({ sessionId, line, canEdit }: { sessionId: string; line: UsageLineDto; canEdit: boolean }) {
  const { t } = useTranslation();
  const update = useUpdateUsage(sessionId);
  const remove = useRemoveUsage(sessionId);
  const [editing, setEditing] = useState(false);
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <Text>{t('sessions.history.usage', { item: line.item.name, amount: line.amount, unit: line.item.unit })}</Text>
        {canEdit && (
          <Group gap="xs" wrap="nowrap">
            <Button mih={44} variant="default" onClick={() => setEditing(true)}>
              {t('nurse.usage.edit')}
            </Button>
            <Button
              mih={44}
              variant="default"
              color="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate(line.id, { onSuccess: () => notifications.show({ message: t('nurse.usage.removed') }) })}
            >
              {t('nurse.usage.remove')}
            </Button>
          </Group>
        )}
      </Group>
      {remove.isError && <Alert color="danger">{errorMessage(t, remove.error)}</Alert>}
      <Modal opened={editing} onClose={() => setEditing(false)} title={line.item.name}>
        {editing && (
          <AmountForm
            itemName={line.item.name}
            unit={line.item.unit}
            initial={String(line.amount)}
            loading={update.isPending}
            error={update.error}
            onSubmit={(amount) =>
              update.mutate(
                { lineId: line.id, amount },
                {
                  onSuccess: () => {
                    notifications.show({ message: t('nurse.usage.updated') });
                    setEditing(false);
                  },
                },
              )
            }
          />
        )}
      </Modal>
    </Stack>
  );
}

function SessionView({ s }: { s: SessionDetail }) {
  const { t } = useTranslation();
  const action = useSessionAction(s.id);
  const canRun = useCan('sessions.run');
  const canPostpone = useCan('sessions.postpone');
  const canUsage = useCan('sessions.recordUsage');
  const canVitals = useCan('sessions.recordVitals');
  const canNotes = useCan('sessions.addNotes');
  const canEditClosed = useCan('sessions.editClosed');
  const canHistory = useCan('sessions.viewHistory');
  const [adding, setAdding] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const recording = s.status === 'active' || s.status === 'completed';
  const writable = s.status === 'active' || (s.status === 'completed' && canEditClosed);
  const done = (key: string) => ({ onSuccess: () => notifications.show({ message: t(key) }) });
  const close = () => {
    setConfirmClose(false);
    action.mutate('close', done('nurse.session.closed'));
  };

  return (
    <Stack gap="md">
      <Anchor component={Link} to="..">
        {t('nav.today')}
      </Anchor>
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap">
          <Title order={2}>{s.patient.name}</Title>
          <Badge variant="light">{t(`sessions.status.${s.status}`)}</Badge>
        </Group>
        <Text c="dimmed">
          {s.chair.label} · {s.shift.name} ({s.shift.start}-{s.shift.end}) · {s.date}
        </Text>
      </Stack>

      {s.orders.length > 0 && (
        <Alert color="warning" title={t('nurse.session.orders')}>
          <Stack gap="xs">
            {s.orders.map((o) => (
              <Text key={o.id}>
                {o.text}
                <Text component="span" size="sm" c="dimmed">
                  {' '}
                  - {o.doctor.name}
                </Text>
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      {action.isError && <Alert color="danger">{errorMessage(t, action.error)}</Alert>}

      {s.status === 'scheduled' && (
        <Stack gap="sm">
          {canRun && s.date === todayLocal() && (
            <Button size="xl" mih={64} loading={action.isPending} onClick={() => action.mutate('open', done('nurse.session.opened'))}>
              {t('nurse.session.open')}
            </Button>
          )}
          {canPostpone && (
            <Button size="lg" mih={44} variant="default" loading={action.isPending} onClick={() => action.mutate('postpone', done('nurse.session.postponed'))}>
              {t('nurse.session.postpone')}
            </Button>
          )}
        </Stack>
      )}

      {recording && (
        <>
          <Card withBorder padding="sm">
            <Stack gap="sm">
              <Title order={4}>{t('nurse.usage.title')}</Title>
              {s.usage.length === 0 && <Text c="dimmed">{t('nurse.usage.none')}</Text>}
              {s.usage.map((l) => (
                <UsageRow key={l.id} sessionId={s.id} line={l} canEdit={writable && canUsage} />
              ))}
              {writable && canUsage && (
                <Button size="lg" mih={56} onClick={() => setAdding(true)}>
                  {t('nurse.usage.add')}
                </Button>
              )}
            </Stack>
          </Card>
          <Card withBorder padding="sm">
            <VitalsForm key={`${s.vitals.weightBefore}-${s.vitals.weightAfter}`} session={s} canEdit={writable && canVitals} />
          </Card>
          <Card withBorder padding="sm">
            <NotesList session={s} canEdit={writable && canNotes} />
          </Card>
        </>
      )}

      {s.status === 'active' && canRun && (
        <Button size="xl" mih={64} color="danger" loading={action.isPending} onClick={() => (hasHeparin(s.usage) ? close() : setConfirmClose(true))}>
          {t('nurse.session.close')}
        </Button>
      )}
      {s.status === 'completed' && canHistory && (
        <Button mih={44} variant="default" onClick={() => setHistoryOpen(true)}>
          {t('nurse.session.history')}
        </Button>
      )}

      <Modal opened={adding} onClose={() => setAdding(false)} title={t('nurse.usage.add')} fullScreen>
        {adding && <UsagePicker sessionId={s.id} usage={s.usage} onDone={() => setAdding(false)} />}
      </Modal>
      <Modal opened={confirmClose} onClose={() => setConfirmClose(false)} title={t('nurse.session.close')}>
        <Stack gap="md">
          <Text>{t('nurse.session.noHeparin')}</Text>
          <Button size="lg" mih={44} color="danger" onClick={close}>
            {t('nurse.session.closeAnyway')}
          </Button>
          <Button size="lg" mih={44} variant="default" onClick={() => setConfirmClose(false)}>
            {t('nurse.session.goBack')}
          </Button>
        </Stack>
      </Modal>
      <HistoryDrawer sessionId={s.id} opened={historyOpen} onClose={() => setHistoryOpen(false)} />
    </Stack>
  );
}

export function SessionPage() {
  const { t } = useTranslation();
  const { sessionId = '' } = useParams();
  const centreId = useCentreId();
  const session = useSession(sessionId);
  return (
    <Stack gap="md" pb="xl">
      {session.isPending && <Loader size="sm" />}
      {session.isError && (
        <Alert color="danger">
          {errorMessage(t, session.error)}{' '}
          <Anchor component={Link} to={`/c/${centreId}/today`}>
            {t('nav.today')}
          </Anchor>
        </Alert>
      )}
      {session.data && <SessionView s={session.data} />}
    </Stack>
  );
}
