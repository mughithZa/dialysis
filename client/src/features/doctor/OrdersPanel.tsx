import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Group, Loader, Stack, Text } from '@mantine/core';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useOrders } from '../desk/api';
import { useEndOrder } from './api';
import { OrderForm } from './OrderForm';

/** Active doctor orders (orders.view); ending and writing orders need orders.write. */
export function OrdersPanel({ patientId }: { patientId: string }) {
  const { t } = useTranslation();
  const canView = useCan('orders.view');
  const canWrite = useCan('orders.write');
  const orders = useOrders(patientId, canView);
  const end = useEndOrder(patientId);
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
                {o.doctor.name} · {t('desk.patient.ordersFrom', { date: o.from })}
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
    </Stack>
  );
}
