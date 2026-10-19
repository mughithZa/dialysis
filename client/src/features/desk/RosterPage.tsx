import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Chip, Group, Loader, Modal, MultiSelect, Select, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useCentreUsers } from '../centre/api';
import { useCreateRoster, useDeleteRoster, useRoster, useSetup, type RosterEntryDto } from './api';
import { formatDate, formatList, timeRange } from '../../i18n/format';
import { shiftDate, todayLocal, weekStartSat } from './dates';

type Period = 'session' | 'day' | 'week' | 'month' | 'custom';
const PERIODS: Period[] = ['session', 'day', 'week', 'month', 'custom'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function RosterPage() {
  const { t } = useTranslation();
  const canAssign = useCan('schedule.assignNurses');
  const setup = useSetup();
  const users = useCentreUsers();
  const create = useCreateRoster();
  const remove = useDeleteRoster();

  const [nurseId, setNurseId] = useState<string | null>(null);
  const [date, setDate] = useState(todayLocal());
  const [blockIds, setBlockIds] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period>('week');
  const [customFrom, setCustomFrom] = useState(todayLocal());
  const [customTo, setCustomTo] = useState(todayLocal());
  const [machineMode, setMachineMode] = useState<'all' | 'chosen'>('all');
  const [chairIds, setChairIds] = useState<string[]>([]);
  const [weekFrom, setWeekFrom] = useState(weekStartSat(todayLocal()));
  const [deleting, setDeleting] = useState<RosterEntryDto | null>(null);

  const weekTo = shiftDate(weekFrom, 6);
  const roster = useRoster(weekFrom, weekTo);

  const blocks = setup.data?.blocks ?? [];
  const machines = (setup.data?.machines ?? []).filter((m) => m.active);
  const nurses = (users.data ?? []).filter((u) => u.active && u.roleKeys.includes('nurse'));

  const range = (() => {
    if (period === 'custom') return { from: customFrom, to: customTo };
    if (!DATE_RE.test(date)) return null;
    const days = period === 'week' ? 6 : period === 'month' ? 29 : 0;
    return { from: date, to: shiftDate(date, days) };
  })();
  const sessionNeedsOneBlock = period === 'session' && blockIds.length !== 1;
  const valid =
    !!nurseId &&
    blockIds.length > 0 &&
    !sessionNeedsOneBlock &&
    !!range &&
    DATE_RE.test(range.from) &&
    DATE_RE.test(range.to) &&
    range.from <= range.to &&
    (machineMode === 'all' || chairIds.length > 0);

  const submit = async () => {
    if (!valid || !range || !nurseId) return;
    try {
      await create.mutateAsync({ nurseId, shiftIds: blockIds, from: range.from, to: range.to, chairIds: machineMode === 'all' ? [] : chairIds });
      notifications.show({ message: t('desk.roster.saved') });
    } catch {
      // surfaced through create.error below
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting.id);
      notifications.show({ message: t('desk.roster.deleted') });
      setDeleting(null);
    } catch {
      // surfaced through remove.error in the dialog
    }
  };

  const loading = setup.isPending || users.isPending;
  const error = setup.error ?? users.error;

  return (
    <Stack gap="md">
      <Title order={2}>{t('desk.roster.title')}</Title>
      {loading && <Loader />}
      {error && <Alert color="danger">{errorMessage(t, error)}</Alert>}
      {users.data && nurses.length === 0 && <Text c="dimmed">{t('desk.roster.noNurses')}</Text>}
      {setup.data && blocks.length === 0 && <Text c="dimmed">{t('desk.roster.noBlocks')}</Text>}

      {canAssign && setup.data && (
        <Card withBorder>
          <Stack gap="md">
            {create.isError && <Alert color="danger">{errorMessage(t, create.error)}</Alert>}
            <Select
              label={t('desk.roster.nurse')}
              value={nurseId}
              onChange={setNurseId}
              data={nurses.map((n) => ({ value: n.id, label: n.name }))}
            />
            <TextInput type="date" label={t('desk.roster.date')} value={date} onChange={(e) => setDate(e.currentTarget.value)} />
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                {t('desk.roster.blocks')}
              </Text>
              <Chip.Group multiple value={blockIds} onChange={setBlockIds}>
                <Group gap="xs">
                  {blocks.map((b) => (
                    <Chip key={b.id} value={b.id} size="md">
                      {b.name}
                    </Chip>
                  ))}
                </Group>
              </Chip.Group>
              {sessionNeedsOneBlock && blockIds.length > 1 && <Text size="sm" c="danger">{t('desk.roster.oneBlock')}</Text>}
            </Stack>
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                {t('desk.roster.period')}
              </Text>
              <Chip.Group value={period} onChange={(v) => setPeriod(v as Period)}>
                <Group gap="xs">
                  {PERIODS.map((p) => (
                    <Chip key={p} value={p} size="md">
                      {t(`desk.roster.${p}`)}
                    </Chip>
                  ))}
                </Group>
              </Chip.Group>
            </Stack>
            {period === 'custom' && (
              <Group grow>
                <TextInput type="date" label={t('desk.roster.from')} value={customFrom} onChange={(e) => setCustomFrom(e.currentTarget.value)} />
                <TextInput type="date" label={t('desk.roster.to')} value={customTo} onChange={(e) => setCustomTo(e.currentTarget.value)} />
              </Group>
            )}
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                {t('desk.roster.machinesLabel')}
              </Text>
              <SegmentedControl
                value={machineMode}
                onChange={(v) => setMachineMode(v as 'all' | 'chosen')}
                data={[
                  { value: 'all', label: t('desk.roster.allMachines') },
                  { value: 'chosen', label: t('desk.roster.chosenMachines') },
                ]}
              />
              {machineMode === 'chosen' && (
                <MultiSelect
                  aria-label={t('desk.roster.machinesPick')}
                  placeholder={t('desk.roster.machinesPlaceholder')}
                  value={chairIds}
                  onChange={setChairIds}
                  data={machines.map((m) => ({ value: m.id, label: m.label }))}
                />
              )}
            </Stack>
            <Button mih={44} disabled={!valid} loading={create.isPending} onClick={() => void submit()}>
              {t('desk.roster.assign')}
            </Button>
          </Stack>
        </Card>
      )}

      <Stack gap="sm">
        <Title order={3}>{t('desk.roster.entries')}</Title>
        <Text size="sm" ta="center">
          {t('desk.roster.dates', { from: formatDate(weekFrom), to: formatDate(weekTo) })}
        </Text>
        <Group grow gap="xs">
          <Button variant="default" mih={44} onClick={() => setWeekFrom(shiftDate(weekFrom, -7))}>
            {t('desk.roster.prevWeek')}
          </Button>
          <Button variant="default" mih={44} onClick={() => setWeekFrom(shiftDate(weekFrom, 7))}>
            {t('desk.roster.nextWeek')}
          </Button>
        </Group>
        {roster.isPending && <Loader />}
        {roster.error && <Alert color="danger">{errorMessage(t, roster.error)}</Alert>}
        {roster.data && roster.data.length === 0 && <Text c="dimmed">{t('desk.roster.none')}</Text>}
        {blocks.map((b) => {
          const entries = (roster.data ?? []).filter((e) => e.shiftId === b.id);
          if (entries.length === 0) return null;
          return (
            <Stack key={b.id} gap="xs">
              <Title order={4}>{`${b.name} (${timeRange(b.start, b.end)})`}</Title>
              {entries.map((e) => (
                <Card key={e.id} withBorder padding="sm">
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Stack gap={2}>
                      <Group gap="xs">
                        <Text fw={500}>{e.nurse.name}</Text>
                        {!e.nurse.active && (
                          <Badge color="warning" variant="light">
                            {t('desk.roster.inactive')}
                          </Badge>
                        )}
                      </Group>
                      <Text size="sm">{t('desk.roster.dates', { from: formatDate(e.from), to: formatDate(e.to) })}</Text>
                      <Text size="sm" c="dimmed">
                        {e.chairs.length === 0 ? t('desk.roster.allMachines') : formatList(e.chairs.map((c) => c.label))}
                      </Text>
                    </Stack>
                    {canAssign && (
                      <Button variant="default" color="danger" mih={44} onClick={() => setDeleting(e)}>
                        {t('desk.roster.delete')}
                      </Button>
                    )}
                  </Group>
                </Card>
              ))}
            </Stack>
          );
        })}
      </Stack>

      <Modal opened={!!deleting} onClose={() => setDeleting(null)} title={t('desk.roster.confirmTitle')}>
        {deleting && (
          <Stack gap="md">
            {remove.isError && <Alert color="danger">{errorMessage(t, remove.error)}</Alert>}
            <Text>{t('desk.roster.confirm', { nurse: deleting.nurse.name, from: formatDate(deleting.from), to: formatDate(deleting.to) })}</Text>
            <Group justify="flex-end">
              <Button variant="default" mih={44} onClick={() => setDeleting(null)}>
                {t('common.cancel')}
              </Button>
              <Button color="danger" mih={44} loading={remove.isPending} onClick={() => void confirmDelete()}>
                {t('desk.roster.delete')}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
