import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, Modal, ScrollArea, Stack, Table, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useCentreId } from '../centre/api';
import { useCalendar, useSetup, type CalendarDto, type SetupDto } from './api';
import { BookDialog, type BookInitial } from './BookDialog';
import { parseLocal as parse, shiftDate as shift, todayLocal, weekStartSat as weekStart } from './dates';

type Day = CalendarDto['days'][number];
type Block = Day['blocks'][number];
type Cell = Block['cells'][number];

const GLYPH: Record<string, string> = {
  scheduled: '○',
  active: '◐',
  completed: '●',
  postponed: '↻',
  missed: '✕',
  did_not_come: '✕',
  cancelled: '✕',
};

interface Pick {
  date: string;
  shiftId: string;
  chairId: string;
}

export function CalendarPage() {
  const { t } = useTranslation();
  const centreId = useCentreId();
  const canBook = useCan('schedule.book');
  const canAssign = useCan('schedule.assignNurses');
  const desktop = useMediaQuery('(min-width: 62em)') ?? false;
  const [anchor, setAnchor] = useState(todayLocal());
  const [picked, setPicked] = useState<Pick | null>(null);

  const from = desktop ? weekStart(anchor) : anchor;
  const to = desktop ? shift(from, 6) : anchor;
  const setup = useSetup();
  const calendar = useCalendar(from, to);
  const step = desktop ? 7 : 1;

  const machines = setup.data?.machines ?? [];
  const blockMeta = (id: string) => setup.data?.blocks.find((b) => b.id === id);
  const labelOf = (chairId: string) => machines.find((m) => m.id === chairId)?.label ?? '';
  const dayLabel = (date: string) => `${t(`desk.weekdays.${parse(date).getDay()}`)} ${parse(date).getDate()}`;

  const nurseLine = (b: Block) => {
    const groups = new Map<string, { name: string; labels: string[] }>();
    const none: string[] = [];
    for (const m of machines) {
      const n = b.nurseByChair[m.id];
      if (!n) none.push(m.label);
      else groups.set(n.id, { name: n.name, labels: [...(groups.get(n.id)?.labels ?? []), m.label] });
    }
    return (
      <Stack gap={4} data-testid="nurses">
        {[...groups.entries()].map(([id, g]) => (
          <Text key={id} size="sm">
            <b>{g.name}</b> <Text span c="dimmed">{g.labels.join(', ')}</Text>
          </Text>
        ))}
        {none.length > 0 && (
          <Badge color="warning" variant="light" size="lg" style={{ alignSelf: 'flex-start' }}>
            {t('desk.calendar.noNurse')}
            {groups.size > 0 ? `: ${none.join(', ')}` : ''}
          </Badge>
        )}
      </Stack>
    );
  };

  const cell = (day: Day, block: Block, c: Cell) => {
    const name = blockMeta(block.shiftId)?.name ?? '';
    if (c.session) {
      const status = t(`desk.calendar.status.${c.session.status}`);
      return (
        <Anchor component={Link} to={`/c/${centreId}/patients/${c.session.patient.id}`} fw={500} style={{ display: 'inline-flex', minHeight: 44, alignItems: 'center', gap: 6 }}>
          <span aria-hidden>{GLYPH[c.session.status] ?? ''}</span>
          {c.session.patient.name}
          <Text span size="xs" c="dimmed">
            {status}
          </Text>
        </Anchor>
      );
    }
    if (c.heldBy) {
      return (
        <Anchor component={Link} to={`/c/${centreId}/patients/${c.heldBy.patientId}`} style={{ display: 'inline-flex', minHeight: 44, alignItems: 'center' }}>
          {c.heldBy.name}
        </Anchor>
      );
    }
    if (!canBook) return <Text c="dimmed">{t('desk.calendar.empty')}</Text>;
    return (
      <Button
        variant="default"
        size="compact-md"
        mih={44}
        aria-label={t('desk.calendar.emptyCell', { label: labelOf(c.chairId), block: name, date: day.date })}
        onClick={() => setPicked({ date: day.date, shiftId: block.shiftId, chairId: c.chairId })}
      >
        {t('desk.calendar.empty')}
      </Button>
    );
  };

  const days = calendar.data?.days ?? [];
  const ready = !!setup.data && !!calendar.data;
  const blocks = (setup.data as SetupDto | undefined)?.blocks ?? [];

  const initial: BookInitial | null = picked && {
    date: picked.date,
    items: [{ weekday: parse(picked.date).getDay(), shiftId: picked.shiftId, chairId: picked.chairId }],
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{t('desk.calendar.title')}</Title>
        {canAssign && (
          <Button component={Link} to={`/c/${centreId}/schedule/roster`} variant="default" mih={44}>
            {t('desk.schedule.assignNurses')}
          </Button>
        )}
      </Group>

      <Group justify="space-between" wrap="nowrap">
        <Button variant="default" mih={44} onClick={() => setAnchor(shift(anchor, -step))}>
          {t('desk.calendar.previous')}
        </Button>
        <Stack gap={0} align="center">
          <Text fw={600}>{desktop ? `${dayLabel(from)} - ${dayLabel(to)}` : dayLabel(from)}</Text>
          <Anchor component="button" type="button" size="sm" onClick={() => setAnchor(todayLocal())}>
            {t('desk.calendar.today')}
          </Anchor>
        </Stack>
        <Button variant="default" mih={44} onClick={() => setAnchor(shift(anchor, step))}>
          {t('desk.calendar.next')}
        </Button>
      </Group>

      {(setup.isPending || calendar.isPending) && <Loader />}
      {setup.isError && <Alert color="danger">{errorMessage(t, setup.error)}</Alert>}
      {calendar.isError && <Alert color="danger">{errorMessage(t, calendar.error)}</Alert>}
      {ready && blocks.length === 0 && <Text c="dimmed">{t('desk.calendar.noBlocks')}</Text>}

      {ready && !desktop &&
        days.map((day) => (
          <Stack key={day.date} gap="md">
            {!day.working && <Text c="dimmed">{t('desk.calendar.dayOff')}</Text>}
            {day.blocks.map((b) => {
              const meta = blockMeta(b.shiftId);
              return (
                <Stack key={b.shiftId} gap="xs">
                  <Text fw={600}>
                    {meta?.name} ({meta?.start}-{meta?.end})
                  </Text>
                  {nurseLine(b)}
                  {b.cells.map((c) => (
                    <Card key={c.chairId} withBorder padding="xs" data-testid={`cell-${b.shiftId}-${c.chairId}`}>
                      <Group justify="space-between" wrap="nowrap">
                        <Text fw={600}>{t('desk.calendar.machine', { label: labelOf(c.chairId) })}</Text>
                        {cell(day, b, c)}
                      </Group>
                    </Card>
                  ))}
                </Stack>
              );
            })}
          </Stack>
        ))}

      {ready && desktop &&
        blocks.map((meta) => (
          <Stack key={meta.id} gap="xs">
            <Text fw={600}>
              {meta.name} ({meta.start}-{meta.end})
            </Text>
            <ScrollArea type="auto">
              <Table withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th />
                    {days.map((d) => (
                      <Table.Th key={d.date}>{dayLabel(d.date)}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Td>{t('desk.calendar.nurses')}</Table.Td>
                    {days.map((d) => {
                      const b = d.blocks.find((x) => x.shiftId === meta.id);
                      return <Table.Td key={d.date}>{b ? nurseLine(b) : <Text c="dimmed">{t('desk.calendar.dayOff')}</Text>}</Table.Td>;
                    })}
                  </Table.Tr>
                  {machines.map((m) => (
                    <Table.Tr key={m.id}>
                      <Table.Td>{t('desk.calendar.machine', { label: m.label })}</Table.Td>
                      {days.map((d) => {
                        const b = d.blocks.find((x) => x.shiftId === meta.id);
                        const c = b?.cells.find((x) => x.chairId === m.id);
                        return <Table.Td key={d.date}>{b && c ? cell(d, b, c) : null}</Table.Td>;
                      })}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Stack>
        ))}

      <Modal opened={initial !== null} onClose={() => setPicked(null)} title={t('desk.book.title')}>
        {initial && picked && <BookDialog key={`${picked.chairId}:${picked.shiftId}:${picked.date}`} initial={initial} onDone={() => setPicked(null)} />}
      </Modal>
    </Stack>
  );
}
