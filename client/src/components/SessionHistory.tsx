import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { apiGet } from '../api';
import { useCentreId } from '../features/centre/api';
import { errorMessage } from '../i18n/errors';

export interface HistorySession {
  id: string;
  date: string;
  status: 'scheduled' | 'active' | 'completed' | 'postponed' | 'missed';
  kind: 'regular' | 'makeup';
  chair: { id: string; label: string };
  shift: { id: string; name: string };
  centreName: string;
  vitals: { weightBefore: number | null; weightAfter: number | null; bp: { at: string; systolic: number; diastolic: number }[] };
  notes: { id: string; text: string; by: { name: string } }[];
  usage: { id: string; item: { name: string; unit: string }; amount: number }[];
}

const PAGE = 20;

/** A patient's past sessions (newest first), across centres, loaded a page at a time. */
export function SessionHistory({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const centreId = useCentreId();
  const q = useInfiniteQuery({
    queryKey: ['desk', centreId, 'history', patientId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<HistorySession[]>(`/centres/${centreId}/patients/${patientId}/sessions?limit=${PAGE}${pageParam ? `&before=${pageParam}` : ''}`),
    // `before` is exclusive of the date; a page boundary inside one date would skip its remainder, which the
    // server's newest-first ordering makes rare enough for the history view.
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]?.date : undefined),
    enabled: !!centreId && !!patientId,
  });
  const sessions = q.data?.pages.flat() ?? [];

  return (
    <Stack gap="sm">
      {q.isPending && <Loader size="sm" />}
      {q.isError && <Alert color="danger">{errorMessage(t, q.error)}</Alert>}
      {q.data && sessions.length === 0 && <Text c="dimmed">{t('sessions.history.empty')}</Text>}
      {sessions.map((s) => (
        <Card key={s.id} withBorder padding="sm">
          <Stack gap={4}>
            <Group justify="space-between" wrap="nowrap">
              <Anchor component={Link} to={`/c/${centreId}/sessions/${s.id}`} fw={600} mih={44} style={{ display: 'inline-flex', alignItems: 'center' }}>
                {s.date}
              </Anchor>
              <Group gap="xs">
                {s.kind === 'makeup' && <Badge variant="light">{t('sessions.history.kind.makeup')}</Badge>}
                <Badge variant="light" color={s.status === 'missed' ? 'danger' : s.status === 'postponed' ? 'warning' : 'neutral'}>
                  {t(`sessions.status.${s.status}`)}
                </Badge>
              </Group>
            </Group>
            <Text size="sm" c="dimmed">
              {s.shift.name} · {s.chair.label} · {s.centreName}
            </Text>
            {s.vitals.weightBefore !== null && <Text size="sm">{t('sessions.history.weightBefore', { kg: s.vitals.weightBefore })}</Text>}
            {s.vitals.weightAfter !== null && <Text size="sm">{t('sessions.history.weightAfter', { kg: s.vitals.weightAfter })}</Text>}
            {s.vitals.bp.map((b) => (
              <Text size="sm" key={b.at}>
                {t('sessions.history.bp', { systolic: b.systolic, diastolic: b.diastolic })}
              </Text>
            ))}
            {s.usage.map((u) => (
              <Text size="sm" key={u.id}>
                {t('sessions.history.usage', { item: u.item.name, amount: u.amount, unit: u.item.unit })}
              </Text>
            ))}
            {s.notes.map((n) => (
              <Text size="sm" key={n.id}>
                {n.text} ({n.by.name})
              </Text>
            ))}
          </Stack>
        </Card>
      ))}
      {q.hasNextPage && (
        <Button mih={44} variant="default" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {t('sessions.history.more')}
        </Button>
      )}
    </Stack>
  );
}
