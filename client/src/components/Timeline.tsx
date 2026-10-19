import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconCalendarOff, IconChevronDown, IconPill } from '@tabler/icons-react';
import { Alert, Anchor, Badge, Button, Card, Collapse, Group, Loader, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { toLocalDate } from '../features/desk/dates';
import { errorMessage } from '../i18n/errors';
import { formatList, timeRange } from '../i18n/format';
import { EmptyState } from './EmptyState';
import { StatusBadge } from './StatusBadge';
import classes from './Timeline.module.css';
import { formatDay, useTimeline, type TimelineItem, type TimelineNote, type TimelineSource } from './timelineApi';

type Entry = { kind: 'session'; date: string; item: TimelineItem } | { kind: 'note'; date: string; note: TimelineNote };

function SessionRow({ item, source, actions }: { item: TimelineItem; source: TimelineSource; actions?: (item: TimelineItem) => ReactNode }) {
  const { t, i18n } = useTranslation();
  const day = formatDay(item.date, i18n.language);
  const extra = actions?.(item);
  return (
    <Card withBorder padding="sm" data-testid={`timeline-row-${item.id}`}>
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          {source.kind === 'staff' && item.linkable ? (
            <Anchor component={Link} to={`/c/${source.centreId}/sessions/${item.id}`} fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {day}
            </Anchor>
          ) : (
            <Text fw={600}>{day}</Text>
          )}
          <Group gap={4} justify="flex-end" align="center">
            {item.kind === 'makeup' && <Badge variant="outline">{t('timeline.makeup')}</Badge>}
            {item.detached && <Badge variant="outline">{t('timeline.moved')}</Badge>}
            {item.oneOff && <Badge variant="outline">{t('timeline.oneOff')}</Badge>}
            <StatusBadge status={item.status} />
            {extra}
          </Group>
        </Group>
        <Text size="sm">
          {item.block} · {timeRange(item.start, item.end)} · {t('timeline.machine', { label: item.chairLabel })}
        </Text>
        <Text size="sm" c="dimmed">
          {item.nurse
            ? t('timeline.nurse', { name: item.nurse.name })
            : t(item.status === 'scheduled' || item.status === 'active' ? 'timeline.noNurse' : 'timeline.nurseNotRecorded')}
          {!item.linkable && item.centreName ? ` · ${item.centreName}` : ''}
        </Text>
        {item.statusReason && <Text size="sm">{item.statusReason}</Text>}
        {item.makeupForDate && <Text size="sm">{t('timeline.makeupFor', { date: formatDay(item.makeupForDate, i18n.language) })}</Text>}
        {item.madeUpOn && <Text size="sm">{t('timeline.madeUpOn', { date: formatDay(item.madeUpOn, i18n.language) })}</Text>}
        {item.medicines.length > 0 && (
          <Text size="sm">{formatList(item.medicines.map((m) => t('timeline.medicine', { name: m.name, amount: m.amount, unit: m.unit })))}</Text>
        )}
      </Stack>
    </Card>
  );
}

/**
 * The patient's own app: one compact row per session (time, machine, nurse, medicines), with the session's nurse notes
 * behind a "Show notes" toggle. Doctor orders are not repeated here; the app shows them once in their own card.
 */
function CompactRow({ item }: { item: TimelineItem }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const notes = item.notes ?? [];
  return (
    <div className={classes.row} data-testid={`timeline-row-${item.id}`}>
      <Stack gap={2}>
        <Group justify="space-between" wrap="nowrap" align="center" gap="xs">
          <Text fw={600}>{formatDay(item.date, i18n.language)}</Text>
          <Group gap={4} justify="flex-end" wrap="nowrap">
            {item.kind === 'makeup' && <Badge variant="outline">{t('timeline.makeup')}</Badge>}
            <StatusBadge status={item.status} />
          </Group>
        </Group>
        <Text size="sm">
          {item.block} · {timeRange(item.start, item.end)} · {t('timeline.machine', { label: item.chairLabel })}
        </Text>
        <Text size="xs" c="dimmed">
          {item.nurse
            ? t('timeline.nurse', { name: item.nurse.name })
            : t(item.status === 'scheduled' || item.status === 'active' ? 'timeline.noNurse' : 'timeline.nurseNotRecorded')}
          {item.centreName ? ` · ${item.centreName}` : ''}
        </Text>
        {item.statusReason && <Text size="sm" dir="auto">{item.statusReason}</Text>}
        {item.makeupForDate && <Text size="sm">{t('timeline.makeupFor', { date: formatDay(item.makeupForDate, i18n.language) })}</Text>}
        {item.madeUpOn && <Text size="sm">{t('timeline.madeUpOn', { date: formatDay(item.madeUpOn, i18n.language) })}</Text>}
        {item.medicines.length > 0 && (
          <Group gap={6} wrap="nowrap" align="flex-start" mt={2}>
            <IconPill size={16} className={classes.medIcon} aria-hidden />
            <Text size="sm">{formatList(item.medicines.map((m) => t('timeline.medicine', { name: m.name, amount: m.amount, unit: m.unit })))}</Text>
          </Group>
        )}
        {notes.length > 0 && (
          <>
            <UnstyledButton mih={44} onClick={() => setOpen((v) => !v)} aria-expanded={open} className={classes.toggle}>
              <IconChevronDown size={16} className={open ? classes.open : undefined} aria-hidden />
              <Text size="sm" fw={600} span>
                {open ? t('timeline.hideNotes') : t('timeline.showNotes')}
              </Text>
            </UnstyledButton>
            <Collapse in={open}>
              <Stack gap={4} className={classes.notes}>
                <Text size="xs" fw={600} c="dimmed">
                  {t('timeline.sessionNotes')}
                </Text>
                {notes.map((n, i) => (
                  <Text key={i} size="sm" dir="auto">
                    {n.text}
                  </Text>
                ))}
              </Stack>
            </Collapse>
          </>
        )}
      </Stack>
    </div>
  );
}

function NoteRow({ note, flat }: { note: TimelineNote; flat?: boolean }) {
  const { t, i18n } = useTranslation();
  const at = new Date(note.at);
  return (
    <Card
      withBorder={!flat}
      radius={flat ? 0 : undefined}
      padding="sm"
      bg="var(--mantine-color-uoca-0)"
      className={flat ? classes.row : undefined}
      data-testid={`timeline-note-${note.id}`}
    >
      <Stack gap={2}>
        <Group gap="xs">
          <Badge variant="light">{t('timeline.note')}</Badge>
          <Text size="xs" c="dimmed">
            {formatDay(toLocalDate(at), i18n.language)} · {note.author.name}
          </Text>
        </Group>
        <Text dir="auto">{note.text}</Text>
      </Stack>
    </Card>
  );
}

function Section({ title, highlight, list, children }: { title: string; highlight?: boolean; list?: boolean; children: ReactNode }) {
  return (
    <Stack gap="xs" p={highlight ? 'xs' : 0} bg={highlight ? 'var(--mantine-color-uoca-1)' : undefined} style={{ borderRadius: 'var(--mantine-radius-md)' }}>
      <Title order={4}>{title}</Title>
      {list ? (
        // the patient's app: compact rows in one card
        <Card padding={0} className={classes.list}>
          {children}
        </Card>
      ) : (
        children
      )}
    </Stack>
  );
}

/**
 * A patient's sessions (Upcoming, Today, Past) with doctor notes at their date. One component for the patient's own app
 * and for staff; `actions` adds a per-row control at the end of the row's header (the front desk's session menu).
 */
export function Timeline({ source, actions }: { source: TimelineSource; actions?: (item: TimelineItem) => ReactNode }) {
  const { t } = useTranslation();
  const q = useTimeline(source);
  const d = q.data;
  const today = toLocalDate(new Date());

  const entries = (items: TimelineItem[], notes: TimelineNote[]): Entry[] => [
    ...notes.map((note): Entry => ({ kind: 'note', date: toLocalDate(new Date(note.at)), note })),
    ...items.map((item): Entry => ({ kind: 'session', date: item.date, item })),
  ];
  // newest first; on the same date a note sits above the sessions (its time of day is unrelated to the block)
  const newestFirst = (a: Entry, b: Entry) => b.date.localeCompare(a.date) || (a.kind === b.kind ? 0 : a.kind === 'note' ? -1 : 1);
  const notesToday = d?.notes.filter((n) => toLocalDate(new Date(n.at)) >= today) ?? [];
  const notesPast = d?.notes.filter((n) => toLocalDate(new Date(n.at)) < today) ?? [];

  const render = (e: Entry) =>
    e.kind === 'note' ? (
      <NoteRow key={`n${e.note.id}`} note={e.note} flat={source.kind === 'me'} />
    ) : source.kind === 'me' ? (
      <CompactRow key={e.item.id} item={e.item} />
    ) : (
      <SessionRow key={e.item.id} item={e.item} source={source} actions={actions} />
    );

  const todayEntries = d ? entries(d.today, notesToday).sort(newestFirst) : [];
  const pastEntries = d ? entries(d.past, notesPast).sort(newestFirst) : [];
  const empty = !!d && d.upcoming.length + todayEntries.length + pastEntries.length === 0;

  return (
    <Stack gap="md">
      {q.isPending && <Loader size="sm" />}
      {q.isError && <Alert color="danger">{errorMessage(t, q.error)}</Alert>}
      {empty && <EmptyState icon={IconCalendarOff} title={t('timeline.empty')} hint={t('empty.timelineHint')} />}
      {todayEntries.length > 0 && (
        <Section title={t('timeline.today')} highlight list={source.kind === 'me'}>
          {todayEntries.map(render)}
        </Section>
      )}
      {d && d.upcoming.length > 0 && (
        <Section title={t('timeline.upcoming')} list={source.kind === 'me'}>{d.upcoming.map((item) => render({ kind: 'session', date: item.date, item }))}</Section>
      )}
      {pastEntries.length > 0 && <Section title={t('timeline.past')} list={source.kind === 'me'}>{pastEntries.map(render)}</Section>}
      {q.hasNextPage && (
        <Button mih={44} variant="default" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {t('timeline.more')}
        </Button>
      )}
    </Stack>
  );
}
