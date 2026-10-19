import { Fragment, lazy, Suspense, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { ActionIcon, Alert, Anchor, Button, Card, Group, Loader, Menu, Modal, PasswordInput, Select, Stack, Tabs, Text, Textarea, Title } from '@mantine/core';
import {
  IconArrowsExchange,
  IconBuildingHospital,
  IconCalendarCog,
  IconCalendarOff,
  IconCalendarPlus,
  IconCalendarRepeat,
  IconChevronLeft,
  IconDots,
  IconKey,
  IconPencil,
  IconPhone,
  IconUserOff,
  type Icon,
} from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { EmptyState } from '../../components/EmptyState';
import { PersonAvatar } from '../../components/PersonAvatar';
import { PatientStatusBadge } from '../../components/StatusBadge';
import { Timeline } from '../../components/Timeline';
import { formatDay, type TimelineItem } from '../../components/timelineApi';
import { useAuth } from '../../auth/AuthProvider';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useCentreId } from '../centre/api';
import { OrdersPanel } from '../doctor/OrdersPanel';
import { usePatient, usePlan, usePostpone, useResetPatientPassword, useSendTransfer, useSetup, useTransferTargets, type PatientDto, type PlanDto, type SetupDto } from './api';
import { BookDialog } from './BookDialog';
import { CancelDialog, DidNotComeDialog } from './CancelDialog';
import { todayLocal } from './dates';
import { WEEKDAY_ORDER } from './weekdays';
import { DischargeDialog } from './DischargeDialog';
import { MakeupDialog } from './MakeupDialog';
import { MoveDialog } from './MoveDialog';
import { formatDate, timeRange } from '../../i18n/format';
import { PatientForm } from './PatientForm';
import calendarClasses from './CalendarPage.module.css';
import classes from './PatientPage.module.css';

// the charts library is large: load it only when a doctor opens Trends
const TrendsPanel = lazy(() => import('../doctor/TrendsPanel').then((m) => ({ default: m.TrendsPanel })));

/** Postpone one session (from its row menu); a make-up for it can follow. */
function PostponeDialog({ row, onDone }: { row: TimelineItem; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const postpone = usePostpone();
  return (
    <Stack gap="sm">
      <Text>{t('desk.postpone.confirmText', { day: formatDay(row.date, i18n.language), block: row.block, time: timeRange(row.start, row.end) })}</Text>
      {postpone.isError && <Alert color="danger">{errorMessage(t, postpone.error)}</Alert>}
      <Button
        mih={44}
        loading={postpone.isPending}
        onClick={() =>
          postpone.mutate(row.id, {
            onSuccess: () => {
              notifications.show({ message: t('desk.postpone.done') });
              onDone();
            },
          })
        }
      >
        {t('desk.postpone.postpone')}
      </Button>
    </Stack>
  );
}

function TransferDialog({ patientId, onDone }: { patientId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const targets = useTransferTargets(true);
  const send = useSendTransfer();
  const [toCentreId, setTo] = useState<string | null>(null);
  const [note, setNote] = useState('');
  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!toCentreId) return;
        send.mutate(
          { patientId, toCentreId, ...(note.trim() ? { note: note.trim() } : {}) },
          {
            onSuccess: () => {
              notifications.show({ message: t('desk.transfer.sent') });
              onDone();
            },
          },
        );
      }}
    >
      {targets.isPending && <Loader size="sm" />}
      {targets.isError && <Alert color="danger">{errorMessage(t, targets.error)}</Alert>}
      {targets.data?.length === 0 && <EmptyState compact icon={IconBuildingHospital} title={t('desk.transfer.noTargets')} />}
      <Select label={t('desk.transfer.target')} value={toCentreId} onChange={setTo} data={(targets.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      <Textarea label={t('desk.transfer.note')} autosize minRows={2} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
      {send.isError && <Alert color="danger">{errorMessage(t, send.error)}</Alert>}
      <Button type="submit" mih={44} loading={send.isPending} disabled={!toCentreId}>
        {t('desk.transfer.send')}
      </Button>
    </Stack>
  );
}

function ResetPasswordDialog({ userId, onDone }: { userId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const reset = useResetPatientPassword();
  const [password, setPassword] = useState('');
  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < 8) return;
        reset.mutate(
          { userId, password },
          {
            onSuccess: () => {
              notifications.show({ message: t('desk.patient.passwordReset') });
              onDone();
            },
          },
        );
      }}
    >
      <PasswordInput label={t('desk.patient.newPassword')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
      {reset.isError && <Alert color="danger">{errorMessage(t, reset.error)}</Alert>}
      <Button type="submit" mih={44} loading={reset.isPending} disabled={password.length < 8}>
        {t('common.save')}
      </Button>
    </Stack>
  );
}

/** The patient record as label / value pairs; empty fields show a dash so the layout stays the same for everyone. */
function RecordList({ patient }: { patient: PatientDto }) {
  const { t } = useTranslation();
  const rows: [string, string | null, boolean?][] = [
    [t('desk.form.phone'), patient.phone, true],
    [t('desk.form.emergencyName'), patient.emergencyContact.name],
    [t('desk.form.emergencyPhone'), patient.emergencyContact.phone, true],
    [t('desk.form.emergencyRelation'), patient.emergencyContact.relation],
    [t('desk.form.kidneyFailureCause'), patient.kidneyFailureCause],
    [t('desk.form.address'), patient.address],
    [t('desk.form.socialSituation'), patient.socialSituation],
    [t('desk.form.financialSituation'), patient.financialSituation],
    [t('desk.form.otherDiseases'), patient.otherDiseases],
    [t('desk.form.notes'), patient.notes],
  ];
  return (
    <Card padding="md">
      <dl className={classes.record}>
        {rows.map(([label, value, phone]) => (
          <div key={label} className={classes.recordRow}>
            <dt>{label}</dt>
            <dd>
              {value ? (
                <span dir={phone ? 'ltr' : 'auto'} style={{ unicodeBidi: 'isolate' }}>
                  {value}
                </span>
              ) : (
                <Text span c="dimmed" aria-label={t('desk.patient.notRecorded')}>
                  —
                </Text>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** The weekly plan as a small weekday (rows) x block (columns) picture (machine label in each booked slot) plus the same as text lines. */
function WeeklyPlan({ plan, setup }: { plan: PlanDto; setup: SetupDto | undefined }) {
  const { t } = useTranslation();
  const blocks = setup?.blocks ?? [];
  const blockName = (id: string) => blocks.find((b) => b.id === id)?.name ?? '';
  const machineLabel = (id: string) => setup?.machines.find((m) => m.id === id)?.label ?? '';
  const items = WEEKDAY_ORDER.flatMap((d) => plan.items.filter((i) => i.weekday === d));
  const working = new Set(setup?.workingDays ?? WEEKDAY_ORDER);
  return (
    <Stack gap="sm">
      {blocks.length > 0 && (
        <table className={classes.plan} aria-hidden>
          <thead>
            <tr>
              <td className={classes.planCorner} />
              {blocks.map((b) => (
                <th key={b.id} scope="col">
                  {b.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAY_ORDER.map((d) => (
              <tr key={d}>
                <th scope="row">{t(`desk.weekdays.${d}`)}</th>
                {blocks.map((b) => {
                  const item = plan.items.find((i) => i.weekday === d && i.shiftId === b.id);
                  return (
                    <td key={b.id}>
                      {item ? (
                        <span className={classes.planSlot} data-plan-slot>
                          {t('desk.calendar.machine', { label: machineLabel(item.chairId) })}
                        </span>
                      ) : (
                        <span className={`${classes.planEmpty} ${working.has(d) ? '' : classes.planOff}`} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Stack gap={2}>
        {items.map((i) => (
          <Text key={`${i.weekday}:${i.shiftId}`} size="sm">
            {t('desk.patient.planLine', { day: t(`desk.weekdays.${i.weekday}`), block: blockName(i.shiftId), chair: machineLabel(i.chairId) })}
          </Text>
        ))}
      </Stack>
      <Text c="dimmed" size="sm">
        {t('desk.patient.planFrom', { date: formatDate(plan.from) })}
        {plan.to ? `${t('common.listSeparator')}${t('desk.patient.planUntil', { date: formatDate(plan.to) })}` : ''}
      </Text>
    </Stack>
  );
}

type Dialog = 'edit' | 'book' | 'changePlan' | 'postpone' | 'makeup' | 'discharge' | 'transfer' | 'reset' | 'move' | 'cancel' | 'dnc';
type PageAction = { key: Dialog; label: string; icon: Icon; danger?: boolean; disabled?: boolean };

function PatientDetails({ patient }: { patient: PatientDto }) {
  const { t, i18n } = useTranslation();
  const centreId = useCentreId();
  const { me } = useAuth();
  const centreName = me?.centres.find((c) => c.id === centreId)?.name;
  const canView = useCan('schedule.view');
  const plan = usePlan(patient.id, canView);
  const setup = useSetup();
  const canHistory = useCan('sessions.view');
  const canOrders = useCan('orders.view');
  const canWriteOrders = useCan('orders.write');
  const can = {
    edit: useCan('patients.edit'),
    book: useCan('schedule.book'),
    postpone: useCan('sessions.postpone'),
    makeup: useCan('schedule.makeup'),
    discharge: useCan('patients.discharge'),
    transfer: useCan('transfers.send'),
    reset: useCan('users.resetPassword'),
  };
  const [dialog, setDialog] = useState<Dialog | null>(null);
  /** The session just postponed, so the make-up that follows is linked to it. */
  const [makeupFor, setMakeupFor] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState<TimelineItem | null>(null);
  const close = () => setDialog(null);
  const act = (d: Dialog, row: TimelineItem) => {
    setTarget(row);
    setDialog(d);
  };

  const active = patient.status === 'active';
  const current = plan.data ?? null;
  const hasPattern = current !== null;
  const planReady = plan.isSuccess && !!setup.data;

  // One actions area: the first action allowed is the primary button, the rest go in "More actions".
  const pageActions = (
    [
      active && can.book && !hasPattern && { key: 'book', label: t('desk.patient.bookPattern'), icon: IconCalendarPlus, disabled: !planReady },
      active && can.makeup && { key: 'makeup', label: t('desk.patient.makeup'), icon: IconCalendarRepeat },
      active && can.book && hasPattern && { key: 'changePlan', label: t('desk.patient.changePlan'), icon: IconCalendarCog, disabled: !planReady },
      can.edit && { key: 'edit', label: t('common.edit'), icon: IconPencil },
      active && can.transfer && { key: 'transfer', label: t('desk.patient.transfer'), icon: IconArrowsExchange },
      can.reset && { key: 'reset', label: t('desk.patient.resetPassword'), icon: IconKey },
      active && can.discharge && { key: 'discharge', label: t('desk.patient.discharge'), icon: IconUserOff, danger: true },
    ] as (PageAction | false)[]
  ).filter((a): a is PageAction => !!a);
  const [primary, ...more] = pageActions;
  const open = (a: PageAction) => {
    if (a.key === 'makeup') setMakeupFor(undefined);
    setDialog(a.key);
  };

  const today = todayLocal();
  /** The front desk's per-session menu, on the rows of this centre that can still be acted on. */
  const rowActions = (r: TimelineItem): ReactNode => {
    if (!active || r.centreId !== centreId) return null;
    if (!(r.status === 'scheduled' || (r.status === 'missed' && r.date <= today))) return null;
    const future = r.date >= today;
    const items: { key: Dialog; label: string; danger?: boolean }[] = [];
    if (can.book && future && r.status === 'scheduled') items.push({ key: 'move', label: t('desk.patient.move') });
    if (can.postpone) items.push({ key: 'postpone', label: t('desk.patient.postpone') });
    if (can.postpone && r.date <= today) items.push({ key: 'dnc', label: t('desk.patient.didNotCome') });
    if (can.postpone && future && r.status === 'scheduled') items.push({ key: 'cancel', label: t('desk.patient.cancel'), danger: true });
    if (items.length === 0) return null;
    return (
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon variant="subtle" size={44} aria-label={t('desk.patient.rowMenu', { day: formatDay(r.date, i18n.language) })}>
            <IconDots size={20} aria-hidden />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {items.map((i) => (
            <Menu.Item key={i.key} mih={44} color={i.danger ? 'danger' : undefined} onClick={() => act(i.key, r)}>
              {i.label}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
    );
  };

  const titles: Record<Dialog, string> = {
    edit: t('desk.patients.editTitle'),
    book: t('desk.book.title'),
    changePlan: t('desk.book.changeTitle'),
    move: t('desk.move.title'),
    cancel: t('desk.cancel.title'),
    dnc: t('desk.didNotCome.title'),
    postpone: t('desk.postpone.title'),
    makeup: t('desk.makeup.title'),
    discharge: t('desk.discharge.title'),
    transfer: t('desk.transfer.title'),
    reset: t('desk.patient.resetPassword'),
  };

  // Tabs by permission. Doctors (who write orders) get weight/BP trends next to Orders and land on Trends.
  const canTrends = canHistory && canWriteOrders;
  const tabs = [
    canHistory && { value: 'sessions', label: t('desk.patient.tabs.sessions') },
    canTrends && { value: 'trends', label: t('desk.patient.tabs.trends') },
    canOrders && { value: 'orders', label: t('desk.patient.tabs.orders') },
    { value: 'record', label: t('desk.patient.tabs.record') },
    canView && { value: 'schedule', label: t('desk.patient.tabs.schedule') },
  ].filter((x): x is { value: string; label: string } => !!x);
  const [tab, setTab] = useState<string | null>(null);
  const currentTab = tab ?? (canTrends ? 'trends' : canWriteOrders && canOrders ? 'orders' : tabs[0]!.value);

  return (
    <Stack gap="md">
      <Card padding="md">
        <Stack gap="md">
          <Group wrap="nowrap" align="flex-start" gap="md">
            <PersonAvatar name={patient.name} size={56} fz={20} />
            <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
              <Group gap="xs" align="center" wrap="wrap">
                <Title order={2} style={{ overflowWrap: 'anywhere' }}>
                  {patient.name}
                </Title>
                <PatientStatusBadge status={patient.status} />
              </Group>
              {patient.phone && (
                <Group gap={6} wrap="nowrap" c="dimmed">
                  <IconPhone size={16} aria-hidden style={{ flexShrink: 0 }} />
                  <Text size="sm" span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                    {patient.phone}
                  </Text>
                </Group>
              )}
              {centreName && (
                <Group gap={6} wrap="nowrap" c="dimmed">
                  <IconBuildingHospital size={16} aria-hidden style={{ flexShrink: 0 }} />
                  <Text size="sm" truncate>
                    {centreName}
                  </Text>
                </Group>
              )}
            </Stack>
          </Group>
          {primary && (
            <Group gap="xs" wrap="nowrap">
              <Button
                mih={44}
                style={{ flex: 1 }}
                leftSection={<primary.icon size={18} aria-hidden />}
                disabled={primary.disabled}
                onClick={() => open(primary)}
              >
                {primary.label}
              </Button>
              {more.length > 0 && (
                <Menu position="bottom-end">
                  <Menu.Target>
                    <Button mih={44} variant="default" leftSection={<IconDots size={18} aria-hidden />}>
                      {t('desk.patient.moreActions')}
                    </Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {more.map((a, i) => (
                      <Fragment key={a.key}>
                        {a.danger && i > 0 && <Menu.Divider />}
                        <Menu.Item
                          mih={44}
                          color={a.danger ? 'danger' : undefined}
                          leftSection={<a.icon size={18} aria-hidden />}
                          disabled={a.disabled}
                          onClick={() => open(a)}
                        >
                          {a.label}
                        </Menu.Item>
                      </Fragment>
                    ))}
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>
          )}
        </Stack>
      </Card>

      {patient.discharge && (
        <Alert color="warning">
          {t('desk.patient.discharged', { date: formatDate(patient.discharge.date), reason: t(`desk.dischargeReason.${patient.discharge.reason}`) })}
        </Alert>
      )}

      <Tabs value={currentTab} onChange={setTab} keepMounted={false} classNames={{ list: classes.tabList, tab: classes.tab }}>
        <Tabs.List grow>
          {tabs.map((x) => (
            <Tabs.Tab key={x.value} value={x.value} mih={44}>
              {x.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {canHistory && (
          <Tabs.Panel value="sessions" pt="md">
            <Timeline source={{ kind: 'staff', centreId, patientId: patient.id }} actions={rowActions} />
          </Tabs.Panel>
        )}
        {canTrends && (
          <Tabs.Panel value="trends" pt="md">
            <Suspense fallback={<Loader size="sm" />}>
              <TrendsPanel patientId={patient.id} />
            </Suspense>
          </Tabs.Panel>
        )}
        {canOrders && (
          <Tabs.Panel value="orders" pt="md">
            <OrdersPanel patientId={patient.id} />
          </Tabs.Panel>
        )}
        <Tabs.Panel value="record" pt="md">
          <RecordList patient={patient} />
        </Tabs.Panel>
        {canView && (
          <Tabs.Panel value="schedule" pt="md">
            <Card padding="md">
              <Stack gap="sm">
                <Text fw={600}>{t('desk.patient.pattern')}</Text>
                {plan.isPending && <Loader size="sm" />}
                {plan.isError && <Alert color="danger">{errorMessage(t, plan.error)}</Alert>}
                {plan.isSuccess && !hasPattern && <EmptyState compact icon={IconCalendarOff} title={t('desk.patient.noPattern')} />}
                {current && <WeeklyPlan plan={current} setup={setup.data} />}
              </Stack>
            </Card>
          </Tabs.Panel>
        )}
      </Tabs>

      <Modal opened={dialog !== null} onClose={close} title={dialog ? titles[dialog] : ''} fullScreen={dialog === 'edit'}>
        {dialog === 'edit' && <PatientForm key={patient.id} patient={patient} onDone={close} />}
        {dialog === 'book' && <BookDialog key="book" initial={{ patientId: patient.id }} onDone={close} />}
        {dialog === 'changePlan' && current && (
          <BookDialog
            key="changePlan"
            mode="change"
            initial={{ patientId: patient.id, items: current.items.map(({ weekday, shiftId, chairId }) => ({ weekday, shiftId, chairId })) }}
            onDone={close}
          />
        )}
        {dialog === 'move' && target && <MoveDialog key={target.id} sessionId={target.id} date={target.date} onDone={close} />}
        {dialog === 'cancel' && target && <CancelDialog key={target.id} sessionId={target.id} onDone={close} />}
        {dialog === 'dnc' && target && <DidNotComeDialog key={target.id} sessionId={target.id} onDone={close} />}
        {dialog === 'postpone' && target && (
          <PostponeDialog
            key={target.id}
            row={target}
            onDone={() => {
              setMakeupFor(target.id);
              setDialog(can.makeup ? 'makeup' : null);
            }}
          />
        )}
        {dialog === 'makeup' && <MakeupDialog key="makeup" patientId={patient.id} forSessionId={makeupFor} onDone={close} />}
        {dialog === 'discharge' && <DischargeDialog key="discharge" patientId={patient.id} onDone={close} />}
        {dialog === 'transfer' && <TransferDialog key="transfer" patientId={patient.id} onDone={close} />}
        {dialog === 'reset' && <ResetPasswordDialog key="reset" userId={patient.userId} onDone={close} />}
      </Modal>
    </Stack>
  );
}

export function PatientPage() {
  const { t } = useTranslation();
  const centreId = useCentreId();
  const id = useParams().patientId ?? '';
  const patient = usePatient(id);
  return (
    <Stack gap="md">
      <Anchor component={Link} to={`/c/${centreId}/patients`} mih={44} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, alignSelf: 'flex-start' }}>
        <IconChevronLeft size={18} className={calendarClasses.flip} aria-hidden />
        {t('desk.patient.back')}
      </Anchor>
      {patient.isPending && <Loader />}
      {patient.isError && <Alert color="danger">{errorMessage(t, patient.error)}</Alert>}
      {patient.data && <PatientDetails key={patient.data.id} patient={patient.data} />}
    </Stack>
  );
}
