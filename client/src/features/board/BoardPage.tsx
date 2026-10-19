import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Card, Group, Loader, Modal, SegmentedControl, SimpleGrid, Stack, Switch, Text } from '@mantine/core';
import { PageHeader } from '../../components/PageHeader';
import {
  IconCalendarOff,
  IconCircleCheck,
  IconClipboardText,
  IconClock,
  IconClockPause,
  IconHeartbeat,
  IconArmchair,
} from '@tabler/icons-react';
import { StatCard } from '../../components/StatCard';
import { EmptyState } from '../../components/EmptyState';
import { StatusBadge } from '../../components/StatusBadge';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { formatDay } from '../../components/timelineApi';
import { useCentreId } from '../centre/api';
import { DidNotComeDialog } from '../desk/CancelDialog';
import { usePostpone } from '../desk/api';
import { todayLocal } from '../desk/dates';
import { MakeupDialog } from '../desk/MakeupDialog';
import { formatDate } from '../../i18n/format';
import { elapsedMinutes, formatElapsed, useNow } from '../nurse/elapsed';
import { timeOf } from '../nurse/VitalsForm';
import { MachineGrid } from './MachineGrid';
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

/** "started 07:05 · 1 h 20 min on the machine", ticking every minute. */
function Elapsed({ row }: { row: BoardRow }) {
  const { t } = useTranslation();
  const now = useNow();
  const started = row.openedAt ? timeOf(row.openedAt) : row.start;
  return (
    <Group gap={6} wrap="nowrap" align="flex-start" c="success.7">
      <IconClock size={16} aria-hidden style={{ flexShrink: 0, marginBlockStart: 2 }} />
      <Text size="sm" fw={600} data-elapsed>
        {row.openedAt ? t('board.elapsed', { time: formatElapsed(t, elapsedMinutes(row.openedAt, now)) }) : null}
        {row.openedAt ? ' · ' : ''}
        {t('board.started', { time: started })}
      </Text>
    </Group>
  );
}

function BoardRowCard({ row, waiting, actions }: { row: BoardRow; waiting: boolean; actions: Actions }) {
  const { t } = useTranslation();
  const centreId = useCentreId();
  const busy = actions.busyId === row.id;
  return (
    <Card withBorder padding="sm">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text fw={600} component={Link} to={`/c/${centreId}/sessions/${row.id}`}>
              {row.patient.name}
            </Text>
            <Text size="sm" c="dimmed">
              {t('board.machine', { label: row.chairLabel })} · {row.nurse ? row.nurse.name : t('board.noNurse')}
            </Text>
            {row.status === 'active' && <Elapsed row={row} />}
          </Stack>
          <Group gap={4} justify="flex-end" wrap="wrap" style={{ flexShrink: 0 }}>
            {row.hasActiveOrders && (
              <Badge variant="light" color="amber" leftSection={<IconClipboardText size={12} aria-hidden />}>
                {t('board.orders')}
              </Badge>
            )}
            <StatusBadge status={waiting ? 'waiting' : row.status} />
          </Group>
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
        {formatDate(row.date)} · {row.shift.name} · {t('board.machine', { label: row.chairLabel })} · {row.patient.name}
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
      <PageHeader title={t('nav.today')} subtitle={d ? formatDay(d.date, i18n.language) : undefined} />
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
            <EmptyState icon={IconCalendarOff} title={t('board.noBlocks')} hint={t('empty.blocksHint')} />
          ) : (
            <SegmentedControl
              fullWidth
              value={d.shiftId ?? ''}
              onChange={setShiftId}
              data={d.blocks.map((b) => ({ value: b.id, label: b.name }))}
              aria-label={t('board.block')}
            />
          )}
          <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
            <StatCard value={d.active.length} label={t('board.statActive')} icon={IconHeartbeat} color="success" />
            <StatCard value={d.waiting.length} label={t('board.statWaiting')} icon={IconClockPause} color="amber" />
            <StatCard value={d.done.length} label={t('board.statDone')} icon={IconCircleCheck} color="uoca" />
            <StatCard value={d.emptyMachines.length} label={t('board.statFree')} icon={IconArmchair} color="neutral" />
          </SimpleGrid>
          <MachineGrid board={d} />
          {canRun && (
            <Stack gap={4}>
              <Switch size="md" label={t('board.mine')} checked={onlyMine} onChange={(e) => setMineOverride(e.currentTarget.checked)} />
              {hidden > 0 && <Text size="sm" c="dimmed">{t('board.hidden', { count: hidden })}</Text>}
            </Stack>
          )}

          <Stack gap="xs">
            <Text fw={600}>{t('board.active', { count: active.length })}</Text>
            {active.length === 0 && <EmptyState compact icon={IconHeartbeat} title={t('board.noneActive')} hint={t('board.noneActiveHint')} />}
            {active.map((r) => (
              <BoardRowCard key={r.id} row={r} waiting={false} actions={actions} />
            ))}
          </Stack>
          <Stack gap="xs">
            <Text fw={600}>{t('board.waiting', { count: waiting.length })}</Text>
            {waiting.length === 0 && <EmptyState compact icon={IconClockPause} title={t('board.noneWaiting')} hint={t('board.noneWaitingHint')} />}
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
