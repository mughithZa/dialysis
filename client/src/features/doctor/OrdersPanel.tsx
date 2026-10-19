import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useOrders } from '../desk/api';
import { formatDay } from '../../components/timelineApi';
import { toLocalDate } from '../desk/dates';
import { useEndOrder, useNotes } from './api';
import { NoteForm } from './NoteForm';
import { formatDate } from '../../i18n/format';
import { OrderForm } from './OrderForm';

const NOTES_SHOWN = 5;

/** Active doctor orders (orders.view) and recent patient notes; ending and writing orders or notes need orders.write. */
export function OrdersPanel({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation();
  const canView = useCan('orders.view');
  const canWrite = useCan('orders.write');
  const orders = useOrders(patientId, canView);
  const end = useEndOrder(patientId);
  const notes = useNotes(patientId, canView);
  if (!canView) return null;
  const active = orders.data?.filter((o) => o.status === 'active');

  return (
    <Stack gap="xs">
      <Text fw={600}>{t('desk.patient.orders')}</Text>
      {orders.isPending && <Loader size="sm" />}
      {orders.isError && <Alert color="danger">{errorMessage(t, orders.error)}</Alert>}
      {active?.length === 0 && <Text c="dimmed">{t('desk.patient.noOrders')}</Text>}
      {active?.map((o) => (
        <Card key={o.id} withBorder padding="sm">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <div>
              <Text>{o.text}</Text>
              <Text size="sm" c="dimmed">
                {o.doctor.name} · {t('desk.patient.ordersFrom', { date: formatDate(o.from) })}
              </Text>
            </div>
            {canWrite && (
              <Button mih={44} variant="default" loading={end.isPending && end.variables === o.id} onClick={() => end.mutate(o.id)}>
                {t('doctor.orders.end')}
              </Button>
            )}
          </Group>
        </Card>
      ))}
      {end.isError && <Alert color="danger">{errorMessage(t, end.error)}</Alert>}
      {canWrite && <OrderForm patientId={patientId} />}

      <Text fw={600} mt="sm">
        {t('doctor.notes.title')}
      </Text>
      {notes.isPending && <Loader size="sm" />}
      {notes.isError && <Alert color="danger">{errorMessage(t, notes.error)}</Alert>}
      {notes.data?.length === 0 && <Text c="dimmed">{t('doctor.notes.none')}</Text>}
      {notes.data?.slice(0, NOTES_SHOWN).map((n) => (
        <Card key={n.id} withBorder padding="sm">
          <Text>{n.text}</Text>
          <Text size="sm" c="dimmed">
            {n.author.name} · {formatDay(toLocalDate(new Date(n.at)), i18n.language)}
          </Text>
        </Card>
      ))}
      {canWrite && <NoteForm patientId={patientId} />}
    </Stack>
  );
}
