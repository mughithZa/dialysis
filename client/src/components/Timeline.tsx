import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { toLocalDate } from '../features/desk/dates';
import { errorMessage } from '../i18n/errors';
import type { SessionStatus } from '../sessionStatus';
import { formatDay, useTimeline, type TimelineItem, type TimelineNote, type TimelineSource } from './timelineApi';

const STATUS_COLOR: Record<SessionStatus, string> = {
  scheduled: 'neutral',
  active: 'warning',
  completed: 'neutral',
  postponed: 'warning',
  missed: 'danger',
  did_not_come: 'danger',
  cancelled: 'neutral',
};

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
          <Group gap={4} justify="flex-end">
            {item.kind === 'makeup' && <Badge variant="outline">{t('timeline.makeup')}</Badge>}
            {item.detached && <Badge variant="outline">{t('timeline.moved')}</Badge>}
            {item.oneOff && <Badge variant="outline">{t('timeline.oneOff')}</Badge>}
            <Badge variant="light" color={STATUS_COLOR[item.status]}>
              {t(`sessions.status.${item.status}`)}
            </Badge>
          </Group>
        </Group>
        <Text size="sm">
          {item.block} · {item.start}–{item.end} · {t('timeline.machine', { label: item.chairLabel })}
        </Text>
        <Text size="sm" c="dimmed">
          {item.nurse ? t('timeline.nurse', { name: item.nurse.name }) : t('timeline.noNurse')}
          {!item.linkable && item.centreName ? ` · ${item.centreName}` : ''}
        </Text>
        {item.statusReason && <Text size="sm">{item.statusReason}</Text>}
        {item.medicines.length > 0 && (
          <Text size="sm">{item.medicines.map((m) => t('timeline.medicine', { name: m.name, amount: m.amount, unit: m.unit })).join(', ')}</Text>
        )}
        {item.notes && item.notes.length > 0 && (
          <Stack gap={2}>
            <Text size="sm" fw={600}>
              {t('timeline.sessionNotes')}
            </Text>
            {item.notes.map((n, i) => (
              <Text key={i} size="sm">
                {n.text}
              </Text>
            ))}
          </Stack>
        )}
        {item.orders && item.orders.length > 0 && (
          <Stack gap={2}>
            <Text size="sm" fw={600}>
              {t('timeline.orders')}
            </Text>
            {item.orders.map((o, i) => (
              <Text key={i} size="sm">
                {t('timeline.order', { text: o.text, date: formatDay(o.from, i18n.language) })}
              </Text>
            ))}
          </Stack>
        )}
        {extra && <Group gap="xs">{extra}</Group>}
      </Stack>
    </Card>
  );
}

function NoteRow({ note }: { note: TimelineNote }) {
  const { t, i18n } = useTranslation();
  const at = new Date(note.at);
  return (
    <Card withBorder padding="sm" bg="var(--mantine-color-neutral-0)" data-testid={`timeline-note-${note.id}`}>
      <Stack gap={2}>
        <Group gap="xs">
          <Badge variant="light">{t('timeline.note')}</Badge>
          <Text size="xs" c="dimmed">
            {formatDay(toLocalDate(at), i18n.language)} · {note.author.name}
          </Text>
        </Group>
        <Text>{note.text}</Text>
      </Stack>
    </Card>
  );
}

function Section({ title, highlight, children }: { title: string; highlight?: boolean; children: ReactNode }) {
  return (
    <Stack gap="xs" p={highlight ? 'xs' : 0} bg={highlight ? 'var(--mantine-color-warning-0)' : undefined} style={{ borderRadius: 'var(--mantine-radius-md)' }}>
      <Title order={4}>{title}</Title>
      {children}
    </Stack>
  );
}

/**
 * A patient's sessions (Upcoming, Today, Past) with doctor notes at their date. One component for the patient's own app
 * and for staff; `actions` adds per-row buttons (the front desk's session actions).
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
    e.kind === 'note' ? <NoteRow key={`n${e.note.id}`} note={e.note} /> : <SessionRow key={e.item.id} item={e.item} source={source} actions={actions} />;

  const todayEntries = d ? entries(d.today, notesToday).sort(newestFirst) : [];
  const pastEntries = d ? entries(d.past, notesPast).sort(newestFirst) : [];
  const empty = !!d && d.upcoming.length + todayEntries.length + pastEntries.length === 0;

  return (
    <Stack gap="md">
      {q.isPending && <Loader size="sm" />}
      {q.isError && <Alert color="danger">{errorMessage(t, q.error)}</Alert>}
      {empty && <Text c="dimmed">{t('timeline.empty')}</Text>}
      {d && d.upcoming.length > 0 && (
        <Section title={t('timeline.upcoming')}>{d.upcoming.map((item) => render({ kind: 'session', date: item.date, item }))}</Section>
      )}
      {todayEntries.length > 0 && (
        <Section title={t('timeline.today')} highlight>
          {todayEntries.map(render)}
        </Section>
      )}
      {pastEntries.length > 0 && <Section title={t('timeline.past')}>{pastEntries.map(render)}</Section>}
      {q.hasNextPage && (
        <Button mih={44} variant="default" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {t('timeline.more')}
        </Button>
      )}
    </Stack>
  );
}
