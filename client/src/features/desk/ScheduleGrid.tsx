import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Button, Card, Group, Loader, Modal, ScrollArea, SegmentedControl, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useCentreId } from '../centre/api';
import { useGrid, type GridDto } from './api';
import { BookDialog, type BookInitial } from './BookDialog';
import { WEEKDAYS } from './dates';

type Slot = GridDto['slots'][number];

export function ScheduleGrid() {
  const { t } = useTranslation();
  const centreId = useCentreId();
  const grid = useGrid();
  const canBook = useCan('schedule.book');
  const canAssign = useCan('schedule.assignNurses');
  const desktop = useMediaQuery('(min-width: 62em)') ?? false;
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [weekday, setWeekday] = useState(String(new Date().getDay()));
  const [booking, setBooking] = useState<BookInitial | null>(null);

  const data = grid.data;
  const shifts = data?.shifts.filter((s) => s.active) ?? [];
  const chairs = data?.chairs.filter((c) => c.active) ?? [];
  const currentShift = shifts.find((s) => s.id === shiftId) ?? shifts[0];
  const slotAt = (chairId: string, sid: string, day: number): Slot | undefined =>
    data?.slots.find((s) => s.chairId === chairId && s.shiftId === sid && s.weekday === day);

  const cell = (chairId: string, sid: string, day: number) => {
    const slot = slotAt(chairId, sid, day);
    if (slot) {
      return (
        <Anchor component={Link} to={`/c/${centreId}/patients/${slot.patient.id}`} fw={500}>
          {slot.patient.name}
        </Anchor>
      );
    }
    if (!canBook) return <Text c="dimmed">{t('desk.schedule.free')}</Text>;
    return (
      <Button variant="default" size="compact-md" mih={44} onClick={() => setBooking({ chairId, shiftId: sid, weekday: day })}>
        {t('desk.schedule.free')}
      </Button>
    );
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{t('desk.schedule.title')}</Title>
        {canAssign && (
          <Button component={Link} to={`/c/${centreId}/schedule/nurses`} variant="default" mih={44}>
            {t('desk.schedule.assignNurses')}
          </Button>
        )}
      </Group>
      {grid.isPending && <Loader />}
      {grid.isError && <Alert color="danger">{errorMessage(t, grid.error)}</Alert>}
      {data && shifts.length === 0 && <Text c="dimmed">{t('desk.schedule.noShifts')}</Text>}
      {data && shifts.length > 0 && chairs.length === 0 && <Text c="dimmed">{t('desk.schedule.noChairs')}</Text>}

      {data && currentShift && chairs.length > 0 && !desktop && (
        <Stack gap="sm">
          {shifts.length > 1 && (
            <Select
              label={t('desk.schedule.shift')}
              allowDeselect={false}
              value={currentShift.id}
              onChange={setShiftId}
              data={shifts.map((s) => ({ value: s.id, label: `${s.name} (${s.start}-${s.end})` }))}
            />
          )}
          <ScrollArea type="auto">
            <SegmentedControl
              aria-label={t('desk.schedule.weekday')}
              value={weekday}
              onChange={setWeekday}
              data={WEEKDAYS.map((d) => ({ value: String(d), label: t(`desk.weekdays.${d}`) }))}
            />
          </ScrollArea>
          {chairs.map((c) => (
            <Card key={c.id} withBorder padding="sm" data-testid={`chair-${c.id}`}>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={600}>{c.label}</Text>
                {cell(c.id, currentShift.id, Number(weekday))}
              </Group>
            </Card>
          ))}
        </Stack>
      )}

      {data && desktop && chairs.length > 0 &&
        shifts.map((s) => (
          <Stack key={s.id} gap="xs">
            <Text fw={600}>
              {s.name} ({s.start}-{s.end})
            </Text>
            <ScrollArea type="auto">
              <Table withTableBorder withColumnBorders>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('desk.schedule.chairs')}</Table.Th>
                    {WEEKDAYS.map((d) => (
                      <Table.Th key={d}>{t(`desk.weekdays.${d}`)}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {chairs.map((c) => (
                    <Table.Tr key={c.id} data-testid={`chair-${c.id}-${s.id}`}>
                      <Table.Td>{c.label}</Table.Td>
                      {WEEKDAYS.map((d) => (
                        <Table.Td key={d}>{cell(c.id, s.id, d)}</Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Stack>
        ))}

      <Modal opened={booking !== null} onClose={() => setBooking(null)} title={t('desk.book.title')}>
        {booking && data && <BookDialog key={`${booking.chairId}:${booking.shiftId}:${booking.weekday}`} grid={data} initial={booking} onDone={() => setBooking(null)} />}
      </Modal>
    </Stack>
  );
}
