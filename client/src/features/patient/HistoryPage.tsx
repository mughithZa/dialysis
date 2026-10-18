import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, Group, List, Loader, Stack, Text, Title } from '@mantine/core';
import { errorMessage } from '../../i18n/errors';
import { formatDay, useHistory, type HistoryRow } from './api';

function Row({ s }: { s: HistoryRow }) {
  const { t, i18n } = useTranslation();
  return (
    <Card withBorder p="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div>
          <Text fw={600}>{formatDay(s.date, i18n.language)}</Text>
          <Text size="sm">
            {s.start}–{s.end} · {s.centreName}
          </Text>
        </div>
        <Badge variant="light">{t(`me.status.${s.status}`)}</Badge>
      </Group>
      <Text fw={500} mt="sm">
        {t('me.medicines')}
      </Text>
      {s.usage.length === 0 ? (
        <Text size="sm" c="dimmed">
          {t('me.noMedicines')}
        </Text>
      ) : (
        <List size="sm" listStyleType="none">
          {s.usage.map((u, i) => (
            <List.Item key={i}>
              {u.name}: {u.amount} {u.unit}
            </List.Item>
          ))}
        </List>
      )}
      {s.notes && s.notes.length > 0 && (
        <>
          <Text fw={500} mt="sm">
            {t('me.notes')}
          </Text>
          {s.notes.map((n, i) => (
            <Text key={i} size="sm">
              {n.text}
            </Text>
          ))}
        </>
      )}
      {s.orders && s.orders.length > 0 && (
        <>
          <Text fw={500} mt="sm">
            {t('me.orders')}
          </Text>
          {s.orders.map((o, i) => (
            <Text key={i} size="sm">
              {o.text}
            </Text>
          ))}
        </>
      )}
    </Card>
  );
}

export function HistoryPage() {
  const { t } = useTranslation();
  const q = useHistory();

  if (q.isPending) return <Loader />;
  if (q.isError) return <Alert color="danger">{errorMessage(t, q.error)}</Alert>;
  const rows = q.data.pages.flat();

  return (
    <Stack gap="md">
      <Button component={Link} to="/me" variant="subtle" mih={44} w="fit-content">
        {t('me.back')}
      </Button>
      <Title order={2}>{t('me.history')}</Title>
      {rows.length === 0 && <Text c="dimmed">{t('me.noHistory')}</Text>}
      {rows.map((s) => (
        <Row key={s.id} s={s} />
      ))}
      {q.hasNextPage && (
        <Button variant="default" mih={44} loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
          {t('me.loadMore')}
        </Button>
      )}
    </Stack>
  );
}
