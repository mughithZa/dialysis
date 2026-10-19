import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, Menu, Modal, PasswordInput, Select, Stack, Text, Textarea, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { Timeline } from '../../components/Timeline';
import { useTimeline, type TimelineItem } from '../../components/timelineApi';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useCentreId } from '../centre/api';
import { OrdersPanel } from '../doctor/OrdersPanel';
import {
  usePatient,
  usePlan,
  usePostpone,
  useResetPatientPassword,
  useSendTransfer,
  useSetup,
  useTransferTargets,
  type PatientDto,
} from './api';
import { BookDialog } from './BookDialog';
import { CancelDialog, DidNotComeDialog } from './CancelDialog';
import { todayLocal } from './dates';
import { WEEKDAY_ORDER } from './weekdays';
import { DischargeDialog } from './DischargeDialog';
import { MakeupDialog } from './MakeupDialog';
import { MoveDialog } from './MoveDialog';
import { PatientForm } from './PatientForm';

function PostponeDialog({ patientId, onDone }: { patientId: string; onDone: (sessionId: string) => void }) {
  const { t } = useTranslation();
  const [date, setDate] = useState(todayLocal());
  const centreId = useCentreId();
  const timeline = useTimeline({ kind: 'staff', centreId, patientId });
  const postpone = usePostpone();
  const rows = timeline.data ? [...timeline.data.upcoming, ...timeline.data.today, ...timeline.data.past] : [];
  const mine = rows.filter((s) => s.date === date && (s.status === 'scheduled' || s.status === 'missed'));
  return (
    <Stack gap="sm">
      <TextInput label={t('desk.postpone.date')} type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
      {timeline.isPending && <Loader size="sm" />}
      {timeline.isError && <Alert color="danger">{errorMessage(t, timeline.error)}</Alert>}
      {timeline.data && mine.length === 0 && <Text c="dimmed">{t('desk.postpone.none')}</Text>}
      {mine.map((s) => (
        <Group key={s.id} justify="space-between" wrap="nowrap">
          <Text>
            {s.block} · {s.chairLabel}
          </Text>
          <Button
            mih={44}
            loading={postpone.isPending && postpone.variables === s.id}
            onClick={() =>
              postpone.mutate(s.id, {
                onSuccess: () => {
                  notifications.show({ message: t('desk.postpone.done') });
                  onDone(s.id);
                },
              })
            }
          >
            {t('desk.postpone.postpone')}
          </Button>
        </Group>
      ))}
      {postpone.isError && <Alert color="danger">{errorMessage(t, postpone.error)}</Alert>}
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
      {targets.data?.length === 0 && <Text c="dimmed">{t('desk.transfer.noTargets')}</Text>}
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

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text>{value}</Text>
    </Stack>
  );
}

type Dialog = 'edit' | 'book' | 'changePlan' | 'postpone' | 'makeup' | 'discharge' | 'transfer' | 'reset' | 'move' | 'cancel' | 'dnc';

function PatientDetails({ patient }: { patient: PatientDto }) {
  const { t } = useTranslation();
  const centreId = useCentreId();
  const canView = useCan('schedule.view');
  const plan = usePlan(patient.id, canView);
  const setup = useSetup();
  const canHistory = useCan('sessions.view');
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
  const blockName = (id: string) => setup.data?.blocks.find((b) => b.id === id)?.name ?? '';
  const machineLabel = (id: string) => setup.data?.machines.find((m) => m.id === id)?.label ?? '';
  const planItems = WEEKDAY_ORDER.flatMap((d) => (current?.items ?? []).filter((i) => i.weekday === d));

  const today = todayLocal();
  const canActOnSessions = active && (can.book || can.postpone);
  /** The front desk's per-session actions, shown on the rows of this centre that can still be acted on. */
  const rowActions = (r: TimelineItem) => {
    if (!canActOnSessions || r.centreId !== centreId) return null;
    if (!(r.status === 'scheduled' || (r.status === 'missed' && r.date <= today))) return null;
    const future = r.date >= today;
    const move = can.book && future && r.status === 'scheduled';
    const cancel = can.postpone && future && r.status === 'scheduled';
    const dnc = can.postpone && r.date <= today;
    if (!move && !cancel && !dnc) return null;
    return (
      <>
        {move && (
          <Button mih={44} variant="default" onClick={() => act('move', r)}>
            {t('desk.patient.move')}
          </Button>
        )}
        {cancel && (
          <Button mih={44} variant="default" onClick={() => act('cancel', r)}>
            {t('desk.patient.cancel')}
          </Button>
        )}
        {dnc && (
          <Button mih={44} variant="default" onClick={() => act('dnc', r)}>
            {t('desk.patient.didNotCome')}
          </Button>
        )}
      </>
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

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Title order={2}>{patient.name}</Title>
        <Badge variant="light" color={patient.status === 'transferring' ? 'warning' : 'neutral'}>
          {t(`desk.patients.status.${patient.status}`)}
        </Badge>
      </Group>
      {patient.discharge && (
        <Alert color="warning">
          {t('desk.patient.discharged', { date: patient.discharge.date, reason: t(`desk.dischargeReason.${patient.discharge.reason}`) })}
        </Alert>
      )}

      <Card withBorder padding="sm">
        <Stack gap="xs">
          <Text fw={600}>{t('desk.patient.record')}</Text>
          <Field label={t('desk.form.phone')} value={patient.phone} />
          <Field label={t('desk.form.emergencyName')} value={patient.emergencyContact.name} />
          <Field label={t('desk.form.emergencyPhone')} value={patient.emergencyContact.phone} />
          <Field label={t('desk.form.emergencyRelation')} value={patient.emergencyContact.relation} />
          <Field label={t('desk.form.kidneyFailureCause')} value={patient.kidneyFailureCause} />
          <Field label={t('desk.form.address')} value={patient.address} />
          <Field label={t('desk.form.socialSituation')} value={patient.socialSituation} />
          <Field label={t('desk.form.financialSituation')} value={patient.financialSituation} />
          <Field label={t('desk.form.otherDiseases')} value={patient.otherDiseases} />
          <Field label={t('desk.form.notes')} value={patient.notes} />
        </Stack>
      </Card>

      <Card withBorder padding="sm">
        <Stack gap="xs">
          <Text fw={600}>{t('desk.patient.pattern')}</Text>
          {canView && plan.isPending && <Loader size="sm" />}
          {plan.isError && <Alert color="danger">{errorMessage(t, plan.error)}</Alert>}
          {plan.isSuccess && !hasPattern && <Text c="dimmed">{t('desk.patient.noPattern')}</Text>}
          {current && (
            <>
              {planItems.map((i) => (
                <Text key={`${i.weekday}:${i.shiftId}`}>
                  {t('desk.patient.planLine', { day: t(`desk.weekdays.${i.weekday}`), block: blockName(i.shiftId), chair: machineLabel(i.chairId) })}
                </Text>
              ))}
              <Text c="dimmed">
                {t('desk.patient.planFrom', { date: current.from })}
                {current.to ? `, ${t('desk.patient.planUntil', { date: current.to })}` : ''}
              </Text>
            </>
          )}
        </Stack>
      </Card>

      {(can.edit || can.reset || (active && (can.book || can.postpone || can.makeup || can.discharge || can.transfer))) && (
        <Stack gap="xs">
          <Text fw={600}>{t('desk.patient.actions')}</Text>
          <Group>
            {can.edit && (
              <Button mih={44} variant="default" onClick={() => setDialog('edit')}>
                {t('common.edit')}
              </Button>
            )}
            {active && can.book && (
              <Button mih={44} variant="default" disabled={!plan.isSuccess || !setup.data} onClick={() => setDialog(hasPattern ? 'changePlan' : 'book')}>
                {t(hasPattern ? 'desk.patient.changePlan' : 'desk.patient.bookPattern')}
              </Button>
            )}
            {active && can.postpone && (
              <Button mih={44} variant="default" onClick={() => setDialog('postpone')}>
                {t('desk.patient.postpone')}
              </Button>
            )}
            {active && can.makeup && (
              <Button
                mih={44}
                variant="default"
                onClick={() => {
                  setMakeupFor(undefined);
                  setDialog('makeup');
                }}
              >
                {t('desk.patient.makeup')}
              </Button>
            )}
            {((active && (can.transfer || can.discharge)) || can.reset) && (
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button mih={44} variant="default">
                    {t('desk.patient.moreActions')}
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {active && can.transfer && (
                    <Menu.Item mih={44} onClick={() => setDialog('transfer')}>
                      {t('desk.patient.transfer')}
                    </Menu.Item>
                  )}
                  {can.reset && (
                    <Menu.Item mih={44} onClick={() => setDialog('reset')}>
                      {t('desk.patient.resetPassword')}
                    </Menu.Item>
                  )}
                  {active && can.discharge && (
                    <Menu.Item mih={44} color="danger" onClick={() => setDialog('discharge')}>
                      {t('desk.patient.discharge')}
                    </Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </Stack>
      )}

      <OrdersPanel patientId={patient.id} />

      {canHistory && (
        <Stack gap="xs">
          <Text fw={600}>{t('timeline.title')}</Text>
          <Timeline source={{ kind: 'staff', centreId, patientId: patient.id }} actions={rowActions} />
        </Stack>
      )}

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
        {dialog === 'postpone' && (
          <PostponeDialog
            key="postpone"
            patientId={patient.id}
            onDone={(sessionId) => {
              setMakeupFor(sessionId);
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
      <Anchor component={Link} to={`/c/${centreId}/patients`}>
        {t('desk.patient.back')}
      </Anchor>
      {patient.isPending && <Loader />}
      {patient.isError && <Alert color="danger">{errorMessage(t, patient.error)}</Alert>}
      {patient.data && <PatientDetails key={patient.data.id} patient={patient.data} />}
    </Stack>
  );
}
