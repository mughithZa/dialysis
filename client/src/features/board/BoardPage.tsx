import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Card, Group, Loader, Modal, SegmentedControl, SimpleGrid, Stack, Switch, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { formatDay } from '../../components/timelineApi';
import { useCentreId } from '../centre/api';
import { DidNotComeDialog } from '../desk/CancelDialog';
import { usePostpone } from '../desk/api';
import { todayLocal } from '../desk/dates';
import { MakeupDialog } from '../desk/MakeupDialog';
import { useBoard, useStartSession, type BoardRow } from './api';

type Dialog = { kind: 'dnc'; row: BoardRow } | { kind: 'makeup'; row: BoardRow } | null;

interface Actions {
  canRun: boolean;
  canPostpone: boolean;
  isToday: boolean;
  busyId: string | null;
  onStart: (row: BoardRow) => void;
  onDnc: (row: BoardRow) => void;
  onPostpone: (row: BoardRow) => void;
}

function BoardRowCard({ row, waiting, actions }: { row: BoardRow; waiting: boolean; actions: Actions }) {
  const { t } = useTranslation();
  const centreId = useCentreId();
  const busy = actions.busyId === row.id;
  return (
    <Card withBorder padding="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2}>
            <Text fw={600} component={Link} to={`/c/${centreId}/sessions/${row.id}`}>
              {row.patient.name}
            </Text>
            <Text size="sm" c="dimmed">
              {t('board.machine', { label: row.chairLabel })} · {row.nurse ? row.nurse.name : t('board.noNurse')}
              {row.status === 'active' ? ` · ${t('board.started', { time: row.start })}` : ''}
            </Text>
          </Stack>
          {row.hasActiveOrders && (
            <Badge variant="filled" color="warning">
              {t('board.orders')}
            </Badge>
          )}
        </Group>
        <SimpleGrid cols={waiting ? 2 : 1} spacing="xs">
          {waiting && actions.canRun && actions.isToday && (
            <Button mih={44} loading={busy} onClick={() => actions.onStart(row)}>
              {t('board.start')}
            </Button>
          )}
          <Button component={Link} to={`/c/${centreId}/sessions/${row.id}`} variant="light" mih={44}>
            {t('board.open')}
          </Button>
          {waiting && actions.canPostpone && (
            <>
              <Button variant="default" mih={44} onClick={() => actions.onDnc(row)}>
                {t('board.didNotCome')}
              </Button>
              <Button variant="default" mih={44} onClick={() => actions.onPostpone(row)}>
                {t('board.postpone')}
              </Button>
            </>
          )}
        </SimpleGrid>
      </Stack>
    </Card>
  );
}

/** A session opened on an earlier day and never closed: open it to close it. */
function UnclosedRow({ row }: { row: BoardRow }) {
  const { t } = useTranslation();
  const centreId = useCentreId();
  return (
    <Group justify="space-between" wrap="nowrap">
      <Text size="sm">
        {row.date} · {row.shift.name} · {t('board.machine', { label: row.chairLabel })} · {row.patient.name}
      </Text>
      <Button component={Link} to={`/c/${centreId}/sessions/${row.id}`} variant="light" mih={44}>
        {t('board.open')}
      </Button>
    </Group>
  );
}

export function BoardPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const centreId = useCentreId();
  const canRun = useCan('sessions.run');
  const canBook = useCan('schedule.book');
  const canPostpone = useCan('sessions.postpone');
  const canMakeup = useCan('schedule.makeup');
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [mineOverride, setMineOverride] = useState<boolean | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const board = useBoard(shiftId);
  const start = useStartSession();
  const postpone = usePostpone();
  const d = board.data;
  const onlyMine = canRun && (mineOverride ?? !canBook);
  const keep = (rows: BoardRow[]) => (onlyMine ? rows.filter((r) => r.mine) : rows);
  const all = d ? [...d.active, ...d.waiting, ...d.done, ...d.didNotCome, ...d.other] : [];
  const hidden = onlyMine ? all.filter((r) => !r.mine).length : 0;
  const close = () => setDialog(null);

  const actions: Actions = {
    canRun,
    canPostpone,
    isToday: !!d && d.date === todayLocal(),
    busyId: (start.isPending && start.variables) || (postpone.isPending && postpone.variables) || null,
    onStart: (row) =>
      start.mutate(row.id, {
        onSuccess: () => {
          notifications.show({ message: t('nurse.session.opened') });
          navigate(`/c/${centreId}/sessions/${row.id}`);
        },
      }),
    onDnc: (row) => setDialog({ kind: 'dnc', row }),
    onPostpone: (row) =>
      postpone.mutate(row.id, {
        onSuccess: () => {
          if (canMakeup) {
            notifications.show({ message: t('desk.postpone.done') });
            setDialog({ kind: 'makeup', row });
          } else {
            notifications.show({ message: t('nurse.session.postponed') });
          }
        },
      }),
  };

  const active = d ? keep(d.active) : [];
  const waiting = d ? keep(d.waiting) : [];
  const error = board.error ?? start.error ?? postpone.error;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={2}>{t('nav.today')}</Title>
        {d && <Text c="dimmed">{formatDay(d.date, i18n.language)}</Text>}
      </Group>
      {board.isPending && <Loader size="sm" />}
      {error && <Alert color="danger">{errorMessage(t, error)}</Alert>}
      {d && d.unclosed.length > 0 && (
        <Alert color="warning" title={t('board.unclosed', { count: d.unclosed.length })}>
          <Stack gap="xs">
            <Text size="sm">{t('board.unclosedHelp')}</Text>
            {d.unclosed.map((r) => (
              <UnclosedRow key={r.id} row={r} />
            ))}
          </Stack>
        </Alert>
      )}
      {d && !d.working && <Text>{t('board.closed')}</Text>}
      {d && d.working && (
        <>
          {d.blocks.length === 0 ? (
            <Text c="dimmed">{t('board.noBlocks')}</Text>
          ) : (
            <SegmentedControl
              fullWidth
              value={d.shiftId ?? ''}
              onChange={setShiftId}
              data={d.blocks.map((b) => ({ value: b.id, label: b.name }))}
              aria-label={t('board.block')}
            />
          )}
          {canRun && <Switch label={t('board.mine')} checked={onlyMine} onChange={(e) => setMineOverride(e.currentTarget.checked)} />}
          {hidden > 0 && <Text size="sm" c="dimmed">{t('board.hidden', { count: hidden })}</Text>}
          <Text size="sm" c="dimmed">
            {t('board.summary', {
              done: keep(d.done).length,
              didNotCome: keep(d.didNotCome).length,
              other: keep(d.other).length,
            })}
            {' · '}
            {t('board.empty', { machines: d.emptyMachines.map((m) => m.label).join(', ') || t('board.noneEmpty') })}
          </Text>

          <Stack gap="xs">
            <Text fw={600}>{t('board.active', { count: active.length })}</Text>
            {active.length === 0 && <Text c="dimmed">{t('board.none')}</Text>}
            {active.map((r) => (
              <BoardRowCard key={r.id} row={r} waiting={false} actions={actions} />
            ))}
          </Stack>
          <Stack gap="xs">
            <Text fw={600}>{t('board.waiting', { count: waiting.length })}</Text>
            {waiting.length === 0 && <Text c="dimmed">{t('board.none')}</Text>}
            {waiting.map((r) => (
              <BoardRowCard key={r.id} row={r} waiting actions={actions} />
            ))}
          </Stack>
        </>
      )}

      <Modal opened={dialog !== null} onClose={close} title={dialog?.kind === 'dnc' ? t('desk.didNotCome.title') : t('desk.makeup.title')}>
        {dialog?.kind === 'dnc' && <DidNotComeDialog key={dialog.row.id} sessionId={dialog.row.id} onDone={close} />}
        {dialog?.kind === 'makeup' && (
          <MakeupDialog key={dialog.row.id} patientId={dialog.row.patient.id} forSessionId={dialog.row.id} onDone={close} />
        )}
      </Modal>
    </Stack>
  );
}
