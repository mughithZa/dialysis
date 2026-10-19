import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ActionIcon, Alert, Badge, Button, Card, Group, Loader, Modal, Stack, Text } from '@mantine/core';
import { IconAlertTriangle, IconCalendarOff, IconChevronLeft, IconChevronRight, IconNurse, IconPlus } from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { PersonAvatar } from '../../components/PersonAvatar';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { formatDay } from '../../components/timelineApi';
import type { StatusTone } from '../../theme';
import { useCentreId } from '../centre/api';
import { NoBreakWords, toneVars } from '../board/MachineGrid';
import boardClasses from '../board/MachineGrid.module.css';
import { useCalendar, useSetup, type CalendarDto, type SetupDto } from './api';
import { BookDialog, type BookInitial } from './BookDialog';
import { formatDate, formatList, timeRange } from '../../i18n/format';
import { parseLocal as parse, shiftDate as shift, todayLocal, weekStartSat as weekStart } from './dates';
import classes from './CalendarPage.module.css';

type Day = CalendarDto['days'][number];
type Block = Day['blocks'][number];
type Cell = Block['cells'][number];
type Machine = SetupDto['machines'][number];
type BlockMeta = SetupDto['blocks'][number];

/** What a calendar cell shows; postponed and cancelled share one look, as do did not come and missed. */
export type CellState = 'booked' | 'active' | 'completed' | 'did_not_come' | 'postponed' | 'free';

/** A cell's state and colour: its session's status, else booked when a weekly plan holds it, else free. */
export function cellState(c: Cell | undefined): { state: CellState; tone: StatusTone | 'free' } {
  const s = c?.session;
  if (s) {
    switch (s.status) {
      case 'scheduled':
        return { state: 'booked', tone: 'scheduled' };
      case 'active':
      case 'completed':
      case 'did_not_come':
        return { state: s.status, tone: s.status };
      case 'missed':
        return { state: 'did_not_come', tone: 'missed' };
      default:
        return { state: 'postponed', tone: s.status };
    }
  }
  if (c?.heldBy) return { state: 'booked', tone: 'scheduled' };
  return { state: 'free', tone: 'free' };
}

const LEGEND: { state: CellState; tone: StatusTone | 'free' }[] = [
  { state: 'booked', tone: 'scheduled' },
  { state: 'active', tone: 'active' },
  { state: 'completed', tone: 'completed' },
  { state: 'did_not_come', tone: 'did_not_come' },
  { state: 'postponed', tone: 'postponed' },
  { state: 'free', tone: 'free' },
];

interface Pick {
  date: string;
  shiftId: string;
  chairId: string;
}

/** Who is rostered on a block: one line per nurse (with their machines when they do not cover all), and a warning for uncovered machines. */
function NurseSummary({ block, machines }: { block: Block; machines: Machine[] }) {
  const { t } = useTranslation();
  const groups = new Map<string, { name: string; labels: string[] }>();
  const none: string[] = [];
  for (const m of machines) {
    const n = block.nurseByChair[m.id];
    if (!n) none.push(m.label);
    else groups.set(n.id, { name: n.name, labels: [...(groups.get(n.id)?.labels ?? []), m.label] });
  }
  const partial = groups.size > 1 || none.length > 0;
  return (
    <Stack gap={4} data-testid="nurses">
      {[...groups.entries()].map(([id, g]) => (
        <Group key={id} gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
          <PersonAvatar name={g.name} size={22} fz={10} />
          <Text size="xs" fw={600} truncate style={{ minWidth: 0 }}>
            {g.name}
          </Text>
          {partial && (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {formatList(g.labels)}
            </Text>
          )}
        </Group>
      ))}
      {none.length > 0 && (
        <Badge
          color="warning"
          variant="light"
          size="sm"
          leftSection={<IconAlertTriangle size={12} aria-hidden />}
          styles={{ root: { height: 'auto', minHeight: 20, alignSelf: 'flex-start', maxWidth: '100%' }, label: { whiteSpace: 'normal' } }}
        >
          {t('desk.calendar.noNurse')}
          {groups.size > 0 ? `: ${formatList(none)}` : ''}
        </Badge>
      )}
    </Stack>
  );
}

/** One column of the grid: a block of one day (phone) or one day of a block (desktop). */
interface Column {
  key: string;
  head: ReactNode;
  today?: boolean;
  date: string;
  block: Block | undefined;
  meta: BlockMeta;
}

/** Machines down the side, columns across; each cell a coloured tile. */
function Grid({ columns, machines, canBook, onPick }: { columns: Column[]; machines: Machine[]; canBook: boolean; onPick: (p: Pick) => void }) {
  const { t } = useTranslation();
  const centreId = useCentreId();

  const tile = (col: Column, m: Machine) => {
    if (!col.block) return <div className={`${classes.tile} ${classes.off}`} aria-hidden />;
    const c = col.block.cells.find((x) => x.chairId === m.id);
    const { state, tone } = cellState(c);
    const where = { label: m.label, block: col.meta.name, date: formatDate(col.date) };
    if (c?.session || c?.heldBy) {
      const name = c.session?.patient.name ?? c.heldBy!.name;
      const patientId = c.session?.patient.id ?? c.heldBy!.patientId;
      const status = c.session ? t(`sessions.status.${tone}`) : t('desk.calendar.legend.booked');
      return (
        <Link
          to={`/c/${centreId}/patients/${patientId}`}
          className={classes.tile}
          style={toneVars(tone)}
          data-cell-state={state}
          aria-label={t('desk.calendar.bookedCell', { ...where, name, status })}
        >
          <span className={classes.name}>
            <NoBreakWords text={name} />
          </span>
        </Link>
      );
    }
    if (!canBook) {
      return (
        <div className={`${classes.tile} ${classes.free}`} data-cell-state="free" aria-label={t('desk.calendar.freeCell', where)}>
          <span aria-hidden>·</span>
        </div>
      );
    }
    return (
      <button
        type="button"
        className={`${classes.tile} ${classes.free}`}
        data-cell-state="free"
        aria-label={t('desk.calendar.emptyCell', where)}
        onClick={() => onPick({ date: col.date, shiftId: col.meta.id, chairId: m.id })}
      >
        <IconPlus size={18} aria-hidden />
      </button>
    );
  };

  return (
    <div className={classes.scroll}>
      <table className={classes.table} style={{ minWidth: 36 + columns.length * 88 }}>
        <thead>
          <tr>
            <td className={classes.corner} />
            {columns.map((col) => (
              <th key={col.key} scope="col" className={`${classes.colHead} ${col.today ? classes.colHeadToday : ''}`}>
                {col.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {machines.map((m) => (
            <tr key={m.id}>
              <th scope="row" className={classes.rowHead} aria-label={t('desk.calendar.machine', { label: m.label })}>
                {m.label}
              </th>
              {columns.map((col) => (
                <td key={col.key} className={classes.cell} data-testid={`cell-${col.date}-${col.meta.id}-${m.id}`}>
                  {tile(col, m)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend({ days }: { days: Day[] }) {
  const { t } = useTranslation();
  const counts = new Map<CellState, number>();
  for (const d of days)
    for (const b of d.blocks)
      for (const c of b.cells) {
        const { state } = cellState(c);
        counts.set(state, (counts.get(state) ?? 0) + 1);
      }
  return (
    <div className={boardClasses.legend}>
      {LEGEND.filter((l) => counts.has(l.state)).map((l) => (
        <span key={l.state} className={boardClasses.legendItem}>
          <span className={`${boardClasses.swatch} ${l.tone === 'free' ? boardClasses.swatchFree : ''}`} style={toneVars(l.tone)} aria-hidden />
          {t('board.legendCount', { label: t(`desk.calendar.legend.${l.state}`), n: counts.get(l.state) })}
        </span>
      ))}
    </div>
  );
}

export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const centreId = useCentreId();
  const canBook = useCan('schedule.book');
  const canAssign = useCan('schedule.assignNurses');
  const desktop = useMediaQuery('(min-width: 62em)') ?? false;
  const today = todayLocal();
  const [anchor, setAnchor] = useState(today);
  const [picked, setPicked] = useState<Pick | null>(null);

  const from = desktop ? weekStart(anchor) : anchor;
  const to = desktop ? shift(from, 6) : anchor;
  const setup = useSetup();
  const calendar = useCalendar(from, to);
  const step = desktop ? 7 : 1;
  const showsToday = from <= today && today <= to;

  const machines = setup.data?.machines ?? [];
  const blocks = setup.data?.blocks ?? [];
  const dayLabel = (date: string) => `${t(`desk.weekdays.${parse(date).getDay()}`)} ${parse(date).getDate()}`;

  const days = calendar.data?.days ?? [];
  const ready = !!setup.data && !!calendar.data;

  const initial: BookInitial | null = picked && {
    date: picked.date,
    items: [{ weekday: parse(picked.date).getDay(), shiftId: picked.shiftId, chairId: picked.chairId }],
  };

  const blockHead = (meta: BlockMeta, block: Block | undefined) => (
    <Stack gap={4}>
      <div>
        <Text size="sm" fw={700} lh={1.2}>
          {meta.name}
        </Text>
        <Text size="xs" c="dimmed">
          {timeRange(meta.start, meta.end)}
        </Text>
      </div>
      {block && <NurseSummary block={block} machines={machines} />}
    </Stack>
  );

  const dayHead = (date: string, block: Block | undefined) => (
    <Stack gap={4}>
      <Text size="sm" fw={700} c={date === today ? 'uoca.8' : undefined}>
        {dayLabel(date)}
      </Text>
      {block ? (
        <NurseSummary block={block} machines={machines} />
      ) : (
        <Text size="xs" c="dimmed">
          {t('desk.calendar.dayOff')}
        </Text>
      )}
    </Stack>
  );

  const phoneDay = days[0];

  return (
    <Stack gap="md">
      <PageHeader
        title={t('desk.calendar.title')}
        action={
          canAssign && (
            <Button component={Link} to={`/c/${centreId}/schedule/roster`} variant="default" mih={44} leftSection={<IconNurse size={18} aria-hidden />}>
              {t('desk.schedule.assignNurses')}
            </Button>
          )
        }
      />

      <Card padding={6}>
        <Group justify="space-between" wrap="nowrap" gap="xs">
          <ActionIcon variant="subtle" size={44} aria-label={t('desk.calendar.previous')} onClick={() => setAnchor(shift(anchor, -step))}>
            <IconChevronLeft size={22} className={classes.flip} aria-hidden />
          </ActionIcon>
          <Stack gap={0} align="center" style={{ flex: 1, minWidth: 0 }}>
            <Text fw={700} ta="center" data-testid="calendar-range">
              {desktop ? t('desk.calendar.range', { from: formatDate(from), to: formatDate(to) }) : formatDay(from, i18n.language)}
            </Text>
            {showsToday && (
              <Text size="xs" c="dimmed">
                {t(desktop ? 'desk.calendar.thisWeek' : 'desk.calendar.today')}
              </Text>
            )}
          </Stack>
          {!showsToday && (
            <Button variant="light" mih={44} px="sm" onClick={() => setAnchor(today)}>
              {t('desk.calendar.today')}
            </Button>
          )}
          <ActionIcon variant="subtle" size={44} aria-label={t('desk.calendar.next')} onClick={() => setAnchor(shift(anchor, step))}>
            <IconChevronRight size={22} className={classes.flip} aria-hidden />
          </ActionIcon>
        </Group>
      </Card>

      {(setup.isPending || calendar.isPending) && <Loader />}
      {setup.isError && <Alert color="danger">{errorMessage(t, setup.error)}</Alert>}
      {calendar.isError && <Alert color="danger">{errorMessage(t, calendar.error)}</Alert>}
      {ready && blocks.length === 0 && <EmptyState icon={IconCalendarOff} title={t('desk.calendar.noBlocks')} hint={t('empty.blocksHint')} />}

      {ready && blocks.length > 0 && !desktop && phoneDay && (
        <Card padding="xs">
          {phoneDay.working ? (
            <Stack gap="sm">
              <Grid
                machines={machines}
                canBook={canBook}
                onPick={setPicked}
                columns={blocks.map((meta) => {
                  const block = phoneDay.blocks.find((b) => b.shiftId === meta.id);
                  return { key: meta.id, date: phoneDay.date, meta, block, head: blockHead(meta, block) };
                })}
              />
              <Legend days={days} />
            </Stack>
          ) : (
            <EmptyState compact icon={IconCalendarOff} title={t('desk.calendar.dayOff')} />
          )}
        </Card>
      )}

      {ready &&
        desktop &&
        blocks.map((meta) => (
          <Card key={meta.id} padding="sm">
            <Stack gap="xs">
              <Group gap="xs">
                <Text fw={700}>{meta.name}</Text>
                <Text c="dimmed" size="sm">
                  {timeRange(meta.start, meta.end)}
                </Text>
              </Group>
              <Grid
                machines={machines}
                canBook={canBook}
                onPick={setPicked}
                columns={days.map((d) => {
                  const block = d.blocks.find((x) => x.shiftId === meta.id);
                  return { key: d.date, date: d.date, meta, block, today: d.date === today, head: dayHead(d.date, block) };
                })}
              />
            </Stack>
          </Card>
        ))}

      {ready && blocks.length > 0 && desktop && <Legend days={days} />}

      <Modal opened={initial !== null} onClose={() => setPicked(null)} title={t('desk.book.title')}>
        {initial && picked && <BookDialog key={`${picked.chairId}:${picked.shiftId}:${picked.date}`} initial={initial} onDone={() => setPicked(null)} />}
      </Modal>
    </Stack>
  );
}
