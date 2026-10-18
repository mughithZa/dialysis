import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Chip, Group, Loader, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useRenameMachine, useSaveSetup, useSetup, type SetupDto } from './api';
import { WEEKDAYS } from './dates';
import { proposeBlocks } from './proposeBlocks';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

interface BlockRow {
  id?: string;
  name: string;
  start: string;
  end: string;
}

function MachineLabel({ id, label, n }: { id: string; label: string; n: number }) {
  const { t } = useTranslation();
  const rename = useRenameMachine();
  const [value, setValue] = useState(label);
  const clean = value.trim();
  return (
    <Group gap="xs" align="flex-end" wrap="nowrap">
      <TextInput aria-label={t('desk.setup.machineLabel', { n })} value={value} onChange={(e) => setValue(e.currentTarget.value)} style={{ flex: 1 }} />
      <Button
        variant="default"
        mih={44}
        aria-label={t('desk.setup.saveLabel', { n })}
        loading={rename.isPending}
        disabled={!clean || clean === label}
        onClick={() => rename.mutate({ id, label: clean }, { onSuccess: () => notifications.show({ message: t('desk.setup.labelSaved') }) })}
      >
        {t('common.save')}
      </Button>
      {rename.isError && <Text c="danger" size="sm">{errorMessage(t, rename.error)}</Text>}
    </Group>
  );
}

function SetupForm({ setup, machines: machineList, canSetup, onSaved }: { setup: SetupDto; machines: SetupDto['machines']; canSetup: boolean; onSaved: (dto: SetupDto) => void }) {
  const { t } = useTranslation();
  const save = useSaveSetup();
  const [machineCount, setMachineCount] = useState(String(setup.machines.length || 1));
  const [dayStart, setDayStart] = useState(setup.blocks[0]?.start ?? '08:00');
  const [dayEnd, setDayEnd] = useState(setup.blocks[setup.blocks.length - 1]?.end ?? '16:00');
  const [sessionCount, setSessionCount] = useState(String(setup.blocks.length || 2));
  const [blocks, setBlocks] = useState<BlockRow[]>(setup.blocks);
  const [days, setDays] = useState<string[]>(setup.workingDays.map(String));

  const count = Number(sessionCount);
  const canPropose = HHMM.test(dayStart) && HHMM.test(dayEnd) && dayStart < dayEnd && Number.isInteger(count) && count >= 1 && count <= 6;
  const machines = Number(machineCount);
  const blocksValid = blocks.length >= 1 && blocks.every((b) => b.name.trim() && HHMM.test(b.start) && HHMM.test(b.end) && b.start < b.end);
  const valid = blocksValid && Number.isInteger(machines) && machines >= 1 && machines <= 100 && days.length >= 1;

  const propose = () => {
    // keep each row's identity by position, so reshaping an existing block does not read as removing it
    setBlocks(proposeBlocks(dayStart, dayEnd, count).map((b, i) => ({ ...b, ...(blocks[i]?.id ? { id: blocks[i]!.id } : {}) })));
  };
  const patchBlock = (i: number, patch: Partial<BlockRow>) => setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <Stack gap="lg">
      <Stack
        gap="md"
        component="form"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (!valid || !canSetup) return;
          save.mutate(
            {
              machineCount: machines,
              blocks: blocks.map((b) => ({ ...(b.id ? { id: b.id } : {}), name: b.name.trim(), start: b.start, end: b.end })),
              workingDays: days.map(Number).sort((a, b) => a - b),
            },
            {
              onSuccess: (dto) => {
                notifications.show({ message: t('desk.setup.saved') });
                onSaved(dto);
              },
            },
          );
        }}
      >
        <TextInput
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          label={t('desk.setup.machineCount')}
          value={machineCount}
          onChange={(e) => setMachineCount(e.currentTarget.value)}
          disabled={!canSetup}
        />

        <Stack gap="xs">
          <Title order={3} size="h4">
            {t('desk.setup.blocks')}
          </Title>
          <SimpleGrid cols={{ base: 1, xs: 3 }}>
            <TextInput type="time" label={t('desk.setup.dayStart')} value={dayStart} onChange={(e) => setDayStart(e.currentTarget.value)} disabled={!canSetup} />
            <TextInput type="time" label={t('desk.setup.dayEnd')} value={dayEnd} onChange={(e) => setDayEnd(e.currentTarget.value)} disabled={!canSetup} />
            <TextInput
              type="number"
              inputMode="numeric"
              min={1}
              max={6}
              label={t('desk.setup.sessionCount')}
              value={sessionCount}
              onChange={(e) => setSessionCount(e.currentTarget.value)}
              disabled={!canSetup}
            />
          </SimpleGrid>
          {canSetup && (
            <Button variant="default" mih={44} onClick={propose} disabled={!canPropose} style={{ alignSelf: 'flex-start' }}>
              {t('desk.setup.propose')}
            </Button>
          )}
          {blocks.map((b, i) => (
            <Card key={b.id ?? `new-${i}`} withBorder padding="sm">
              <SimpleGrid cols={{ base: 1, xs: 3 }}>
                <TextInput aria-label={t('desk.setup.blockName', { n: i + 1 })} value={b.name} onChange={(e) => patchBlock(i, { name: e.currentTarget.value })} disabled={!canSetup} />
                <TextInput type="time" aria-label={t('desk.setup.blockStart', { n: i + 1 })} value={b.start} onChange={(e) => patchBlock(i, { start: e.currentTarget.value })} disabled={!canSetup} />
                <TextInput type="time" aria-label={t('desk.setup.blockEnd', { n: i + 1 })} value={b.end} onChange={(e) => patchBlock(i, { end: e.currentTarget.value })} disabled={!canSetup} />
              </SimpleGrid>
            </Card>
          ))}
          {!blocksValid && blocks.length > 0 && <Text size="sm" c="danger">{t('desk.setup.invalid')}</Text>}
        </Stack>

        <Stack gap={4}>
          <Text size="sm" fw={500}>
            {t('desk.setup.workingDays')}
          </Text>
          <Chip.Group multiple value={days} onChange={setDays}>
            <Group gap="xs">
              {WEEKDAYS.map((d) => (
                <Chip key={d} value={String(d)} size="md" disabled={!canSetup}>
                  {t(`desk.weekdays.${d}`)}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </Stack>

        {save.isError && <Alert color="danger">{errorMessage(t, save.error)}</Alert>}
        {canSetup && (
          <Button type="submit" mih={44} loading={save.isPending} disabled={!valid}>
            {t('desk.setup.save')}
          </Button>
        )}
      </Stack>

      {machineList.length > 0 && (
        <Stack gap="xs">
          <Title order={3} size="h4">
            {t('desk.setup.machineLabels')}
          </Title>
          {machineList.map((m, i) => (
            <MachineLabel key={`${m.id}:${m.label}`} id={m.id} label={m.label} n={i + 1} />
          ))}
        </Stack>
      )}
    </Stack>
  );
}

export function SetupPage() {
  const { t } = useTranslation();
  const setup = useSetup();
  const canSetup = useCan('schedule.setup');
  // after a Save the form restarts from the server's answer (so new blocks carry their ids); a refetch alone never resets edits
  const [saved, setSaved] = useState<{ dto: SetupDto; version: number } | null>(null);
  return (
    <Stack gap="md">
      <Title order={2}>{t('desk.setup.title')}</Title>
      {setup.isPending && <Loader />}
      {setup.isError && <Alert color="danger">{errorMessage(t, setup.error)}</Alert>}
      {setup.data && (
        <SetupForm
          key={saved?.version ?? 0}
          setup={saved?.dto ?? setup.data}
          machines={setup.data.machines}
          canSetup={canSetup}
          onSaved={(dto) => setSaved({ dto, version: (saved?.version ?? 0) + 1 })}
        />
      )}
    </Stack>
  );
}
