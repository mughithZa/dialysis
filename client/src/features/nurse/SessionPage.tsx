import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, Modal, Spoiler, Stack, Tabs, Text, Title } from '@mantine/core';
import {
  IconChevronLeft,
  IconClipboardText,
  IconClock,
  IconHeartRateMonitor,
  IconHistory,
  IconNote,
  IconPill,
  IconCircleCheck,
} from '@tabler/icons-react';
import { StatusBadge } from '../../components/StatusBadge';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { formatDay } from '../../components/timelineApi';
import { errorMessage } from '../../i18n/errors';
import { useCentreId } from '../centre/api';
import { toLocalDate, todayLocal } from '../desk/dates';
import { hasHeparin, useSession, useSessionAction, type SessionDetail } from './api';
import { elapsedMinutes, formatElapsed, useNow } from './elapsed';
import { HistoryDrawer } from './HistoryDrawer';
import { NotesList } from './NotesList';
import { UsageList } from './UsageList';
import { timeRange } from '../../i18n/format';
import { VitalsForm } from './VitalsForm';
import classes from './SessionPage.module.css';

/** Running time of an active session (ticks every minute) or how long a completed one lasted. */
function SessionTimer({ s }: { s: SessionDetail }) {
  const { t } = useTranslation();
  const now = useNow();
  if (!s.openedAt) return null;
  if (s.status === 'active') {
    return (
      <span className={classes.timer} data-session-timer>
        <IconClock size={16} aria-hidden />
        <Text span size="sm" fw={500}>
          {t('nurse.session.running')}
        </Text>
        <span>{formatElapsed(t, elapsedMinutes(s.openedAt, now))}</span>
      </span>
    );
  }
  if (s.status === 'completed' && s.closedAt) {
    return (
      <span className={`${classes.timer} ${classes.timerDone}`} data-session-timer>
        <IconClock size={16} aria-hidden />
        <Text span size="sm" fw={500}>
          {t('nurse.session.duration')}
        </Text>
        <span>{formatElapsed(t, elapsedMinutes(s.openedAt, new Date(s.closedAt)))}</span>
      </span>
    );
  }
  return null;
}

/** Sticky card at the top: who, where and when, the status and the running timer. */
function SessionSummary({ s }: { s: SessionDetail }) {
  const { t, i18n } = useTranslation();
  return (
    <Card padding="sm" shadow="md" className={classes.summary}>
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Title order={3} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {s.patient.name}
          </Title>
          <StatusBadge status={s.status} size="lg" />
        </Group>
        <Text c="dimmed" size="sm">
          {t('board.machine', { label: s.chairLabel })} · {s.shift.name} ({timeRange(s.start, s.end)}) · {formatDay(s.date, i18n.language)}
        </Text>
        <Group gap="xs">
          <SessionTimer s={s} />
        </Group>
      </Stack>
    </Card>
  );
}

/** Doctor orders and recent doctor notes as one highlighted callout; long content folds behind "Show more". */
function OrdersCallout({ s }: { s: SessionDetail }) {
  const { t, i18n } = useTranslation();
  if (s.orders.length === 0 && s.recentNotes.length === 0) return null;
  return (
    <div className={classes.orders} role="note" aria-label={t('nurse.session.orders')}>
      <Group gap={6} wrap="nowrap" mb={4} c="amber.7">
        <IconClipboardText size={18} aria-hidden />
        <Text fw={700} size="sm">
          {t('nurse.session.orders')}
        </Text>
      </Group>
      <Spoiler maxHeight={88} showLabel={t('common.showMore')} hideLabel={t('common.showLess')} styles={{ control: { minHeight: 44, fontWeight: 600 } }}>
        <Stack gap={6}>
          {s.orders.map((o) => (
            <Text key={o.id} size="sm" dir="auto">
              {o.text}
              <Text component="span" size="xs" c="dimmed">
                {' '}
                - {o.doctor.name}
              </Text>
            </Text>
          ))}
          {s.recentNotes.length > 0 && (
            <Text fw={600} size="xs" c="amber.7">
              {t('doctor.notes.title')}
            </Text>
          )}
          {s.recentNotes.map((n) => (
            <Text key={n.id} size="sm" dir="auto">
              {n.text}
              <Text component="span" size="xs" c="dimmed">
                {' '}
                - {n.author.name}, {formatDay(toLocalDate(new Date(n.at)), i18n.language)}
              </Text>
            </Text>
          ))}
        </Stack>
      </Spoiler>
    </div>
  );
}

const count = (n: number) =>
  n > 0 ? (
    <Badge size="sm" circle variant="light" color="uoca">
      {n}
    </Badge>
  ) : null;

function SessionView({ s }: { s: SessionDetail }) {
  const { t } = useTranslation();
  const centreId = useCentreId();
  const action = useSessionAction(s.id);
  const canRun = useCan('sessions.run');
  const canPostpone = useCan('sessions.postpone');
  const canUsage = useCan('sessions.recordUsage');
  const canVitals = useCan('sessions.recordVitals');
  const canNotes = useCan('sessions.addNotes');
  const canEditClosed = useCan('sessions.editClosed');
  const canHistory = useCan('sessions.viewHistory');
  const [tab, setTab] = useState<string | null>('usage');
  const [confirmClose, setConfirmClose] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const recording = s.status === 'active' || s.status === 'completed';
  // Active sessions need the record permission; completed ones are corrected with sessions.editClosed alone.
  const may = (perm: boolean) => (s.status === 'active' ? perm : s.status === 'completed' && canEditClosed);
  const done = (key: string) => ({ onSuccess: () => notifications.show({ message: t(key) }) });
  const close = () => {
    setConfirmClose(false);
    action.mutate('close', done('nurse.session.closed'));
  };

  return (
    <Stack gap="md">
      <Anchor
        component={Link}
        to={canRun ? `/c/${centreId}/today` : `/c/${centreId}/patients/${s.patient.id}`}
        mih={44}
        fw={600}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}
      >
        <IconChevronLeft size={18} className={classes.flip} aria-hidden />
        {t(canRun ? 'nav.today' : 'nurse.session.toPatient')}
      </Anchor>
      <SessionSummary s={s} />
      <OrdersCallout s={s} />

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
        <Tabs value={tab} onChange={setTab} aria-label={t('nurse.session.sections')} classNames={{ list: classes.tabList, tab: classes.tab }}>
          <Tabs.List grow mb="sm">
            <Tabs.Tab value="usage" mih={48} leftSection={<IconPill size={18} />} rightSection={count(s.usage.length)}>
              {t('nurse.tabs.usage')}
            </Tabs.Tab>
            <Tabs.Tab value="vitals" mih={48} leftSection={<IconHeartRateMonitor size={18} />}>
              {t('nurse.tabs.vitals')}
            </Tabs.Tab>
            <Tabs.Tab value="notes" mih={48} leftSection={<IconNote size={18} />} rightSection={count(s.notes.length)}>
              {t('nurse.tabs.notes')}
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="usage">
            <Card padding="sm">
              <Stack gap="sm">
                <Title order={4}>{t('nurse.usage.title')}</Title>
                <UsageList session={s} canEdit={may(canUsage)} />
              </Stack>
            </Card>
          </Tabs.Panel>
          <Tabs.Panel value="vitals">
            <Card padding="sm">
              <VitalsForm key={`${s.vitals.weightBefore}-${s.vitals.weightAfter}`} session={s} canEdit={may(canVitals)} />
            </Card>
          </Tabs.Panel>
          <Tabs.Panel value="notes">
            <Card padding="sm">
              <Stack gap="sm">
                <Title order={4}>{t('nurse.notes.title')}</Title>
                <NotesList session={s} canEdit={may(canNotes)} />
              </Stack>
            </Card>
          </Tabs.Panel>
        </Tabs>
      )}

      {s.status === 'completed' && canHistory && (
        <Button mih={44} variant="default" leftSection={<IconHistory size={18} />} onClick={() => setHistoryOpen(true)}>
          {t('nurse.session.history')}
        </Button>
      )}

      {s.status === 'active' && canRun && (
        <div className={classes.actionBar}>
          <Button
            fullWidth
            size="lg"
            mih={56}
            color="danger"
            leftSection={<IconCircleCheck size={20} />}
            loading={action.isPending}
            onClick={() => (hasHeparin(s.usage) ? close() : setConfirmClose(true))}
          >
            {t('nurse.session.close')}
          </Button>
        </div>
      )}

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
