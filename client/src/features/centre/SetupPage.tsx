import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Group, Loader, Modal, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useChairs, useSaveChair, useSaveShift, useShifts, type Chair, type Shift } from './api';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function ChairForm({ chair, onDone }: { chair: Chair | null; onDone: () => void }) {
  const { t } = useTranslation();
  const save = useSaveChair();
  const [label, setLabel] = useState(chair?.label ?? '');
  const [active, setActive] = useState(chair?.active ?? true);
  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!label.trim()) return;
        save.mutate(
          { ...(chair ? { id: chair.id, active } : {}), label: label.trim() },
          {
            onSuccess: () => {
              notifications.show({ message: t('centre.setup.saved') });
              onDone();
            },
          },
        );
      }}
    >
      <TextInput label={t('centre.setup.chairLabel')} value={label} onChange={(e) => setLabel(e.currentTarget.value)} required />
      {chair && <Switch size="md" label={t('centre.users.active')} checked={active} onChange={(e) => setActive(e.currentTarget.checked)} />}
      {save.isError && <Alert color="danger">{errorMessage(t, save.error)}</Alert>}
      <Button type="submit" mih={44} loading={save.isPending} disabled={!label.trim()}>
        {t('common.save')}
      </Button>
    </Stack>
  );
}

function ShiftForm({ shift, onDone }: { shift: Shift | null; onDone: () => void }) {
  const { t } = useTranslation();
  const save = useSaveShift();
  const [name, setName] = useState(shift?.name ?? '');
  const [start, setStart] = useState(shift?.start ?? '08:00');
  const [end, setEnd] = useState(shift?.end ?? '12:00');
  const [active, setActive] = useState(shift?.active ?? true);
  const valid = name.trim() && HHMM.test(start) && HHMM.test(end) && start < end;
  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        save.mutate(
          { ...(shift ? { id: shift.id, active } : {}), name: name.trim(), start, end },
          {
            onSuccess: () => {
              notifications.show({ message: t('centre.setup.saved') });
              onDone();
            },
          },
        );
      }}
    >
      <TextInput label={t('centre.setup.shiftName')} value={name} onChange={(e) => setName(e.currentTarget.value)} required />
      <TextInput type="time" label={t('centre.setup.start')} value={start} onChange={(e) => setStart(e.currentTarget.value)} required />
      <TextInput
        type="time"
        label={t('centre.setup.end')}
        value={end}
        onChange={(e) => setEnd(e.currentTarget.value)}
        error={HHMM.test(start) && HHMM.test(end) && start >= end ? t('centre.setup.endAfterStart') : undefined}
        required
      />
      {shift && <Switch size="md" label={t('centre.users.active')} checked={active} onChange={(e) => setActive(e.currentTarget.checked)} />}
      {save.isError && <Alert color="danger">{errorMessage(t, save.error)}</Alert>}
      <Button type="submit" mih={44} loading={save.isPending} disabled={!valid}>
        {t('common.save')}
      </Button>
    </Stack>
  );
}

export function SetupPage() {
  const { t } = useTranslation();
  const chairs = useChairs();
  const shifts = useShifts();
  const canSetup = useCan('schedule.setup');
  const [chair, setChair] = useState<Chair | 'new' | null>(null);
  const [shift, setShift] = useState<Shift | 'new' | null>(null);

  return (
    <Stack gap="lg">
      <Title order={2}>{t('centre.setup.title')}</Title>

      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={3} size="h4">
            {t('centre.setup.shifts')}
          </Title>
          {canSetup && (
            <Button mih={44} onClick={() => setShift('new')}>
              {t('centre.setup.addShift')}
            </Button>
          )}
        </Group>
        {shifts.isPending && <Loader />}
        {shifts.isError && <Alert color="danger">{errorMessage(t, shifts.error)}</Alert>}
        {shifts.data?.length === 0 && <Text c="dimmed">{t('centre.setup.noShifts')}</Text>}
        {shifts.data?.map((s) => (
          <Card key={s.id} withBorder padding="sm">
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={0}>
                <Text fw={600}>{s.name}</Text>
                <Text size="sm" c="dimmed">
                  {s.start} - {s.end}
                </Text>
              </Stack>
              <Group gap="xs" wrap="nowrap">
                {!s.active && (
                  <Badge color="warning" variant="light">
                    {t('centre.users.inactive')}
                  </Badge>
                )}
                {canSetup && (
                  <Button mih={44} variant="default" onClick={() => setShift(s)}>
                    {t('common.edit')}
                  </Button>
                )}
              </Group>
            </Group>
          </Card>
        ))}
      </Stack>

      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={3} size="h4">
            {t('centre.setup.chairs')}
          </Title>
          {canSetup && (
            <Button mih={44} onClick={() => setChair('new')}>
              {t('centre.setup.addChair')}
            </Button>
          )}
        </Group>
        {chairs.isPending && <Loader />}
        {chairs.isError && <Alert color="danger">{errorMessage(t, chairs.error)}</Alert>}
        {chairs.data?.length === 0 && <Text c="dimmed">{t('centre.setup.noChairs')}</Text>}
        {chairs.data?.map((c) => (
          <Card key={c.id} withBorder padding="sm">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={600}>{c.label}</Text>
              <Group gap="xs" wrap="nowrap">
                {!c.active && (
                  <Badge color="warning" variant="light">
                    {t('centre.users.inactive')}
                  </Badge>
                )}
                {canSetup && (
                  <Button mih={44} variant="default" onClick={() => setChair(c)}>
                    {t('common.edit')}
                  </Button>
                )}
              </Group>
            </Group>
          </Card>
        ))}
      </Stack>

      <Modal opened={shift !== null} onClose={() => setShift(null)} title={t('centre.setup.shifts')}>
        {shift !== null && <ShiftForm key={shift === 'new' ? 'new' : shift.id} shift={shift === 'new' ? null : shift} onDone={() => setShift(null)} />}
      </Modal>
      <Modal opened={chair !== null} onClose={() => setChair(null)} title={t('centre.setup.chairs')}>
        {chair !== null && <ChairForm key={chair === 'new' ? 'new' : chair.id} chair={chair === 'new' ? null : chair} onDone={() => setChair(null)} />}
      </Modal>
    </Stack>
  );
}
