import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Collapse, Group, Loader, Modal, SegmentedControl, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconClipboardText, IconNote, IconPencilPlus, IconPlayerStop } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useOrders, type OrderDto } from '../desk/api';
import { formatDay } from '../../components/timelineApi';
import { toLocalDate } from '../desk/dates';
import { useEndOrder, useNotes } from './api';
import { NoteForm } from './NoteForm';
import { formatDate } from '../../i18n/format';
import { OrderForm } from './OrderForm';
import classes from './OrdersPanel.module.css';

const NOTES_SHOWN = 5;
const ACTIVE_STYLE = { borderInlineStart: '4px solid var(--mantine-color-amber-5)' };
const ENDED_STYLE = { borderInlineStart: '4px solid var(--mantine-color-grey-3)', backgroundColor: 'var(--mantine-color-grey-0)' };
type Kind = 'order' | 'note';

function OrderCard({ order, ended, action }: { order: OrderDto; ended?: boolean; action?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    // the theme's Card styles are inline, so the bar and tint go through `styles` too
    <Card padding="sm" styles={{ root: ended ? ENDED_STYLE : ACTIVE_STYLE }} className={ended ? classes.ended : undefined} data-order={order.status}>
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="sm">
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Text dir="auto" className={classes.text}>
            {order.text}
          </Text>
          <Text size="sm" c="dimmed">
            {order.doctor.name} · {t('desk.patient.ordersFrom', { date: formatDate(order.from) })}
          </Text>
        </Stack>
        {ended ? <Badge color="grey" variant="outline">{t('doctor.orders.endedBadge')}</Badge> : action}
      </Group>
    </Card>
  );
}

/**
 * Doctor orders (active, then ended) and recent patient notes, read with orders.view. With orders.write one
 * "New order / note" action opens the writing form, and active orders can be ended.
 */
export function OrdersPanel({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation();
  const canView = useCan('orders.view');
  const canWrite = useCan('orders.write');
  const orders = useOrders(patientId, canView);
  const end = useEndOrder(patientId);
  const notes = useNotes(patientId, canView);
  const [writing, setWriting] = useState<Kind | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [allNotes, setAllNotes] = useState(false);
  if (!canView) return null;
  const active = orders.data?.filter((o) => o.status === 'active');
  const ended = orders.data?.filter((o) => o.status === 'ended') ?? [];
  const shownNotes = allNotes ? notes.data : notes.data?.slice(0, NOTES_SHOWN);

  return (
    <Stack gap="md">
      {canWrite && (
        <Button mih={44} leftSection={<IconPencilPlus size={18} />} onClick={() => setWriting('order')}>
          {t('doctor.new')}
        </Button>
      )}

      <Stack gap="xs">
        <Group gap="xs">
          <ThemeIcon variant="light" color="amber" size={28} radius="md" aria-hidden>
            <IconClipboardText size={16} />
          </ThemeIcon>
          <Text fw={600}>{t('doctor.orders.active')}</Text>
          {!!active?.length && (
            <Badge color="amber" variant="light" size="sm">
              {active.length}
            </Badge>
          )}
        </Group>
        {orders.isPending && <Loader size="sm" />}
        {orders.isError && <Alert color="danger">{errorMessage(t, orders.error)}</Alert>}
        {active?.length === 0 && (
          <EmptyState compact icon={IconClipboardText} title={t('desk.patient.noOrders')} hint={canWrite ? t('doctor.orders.noneHint') : undefined} />
        )}
        {active?.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            action={
              canWrite && (
                <Button
                  mih={44}
                  variant="default"
                  leftSection={<IconPlayerStop size={16} />}
                  loading={end.isPending && end.variables === o.id}
                  onClick={() => end.mutate(o.id)}
                >
                  {t('doctor.orders.end')}
                </Button>
              )
            }
          />
        ))}
        {end.isError && <Alert color="danger">{errorMessage(t, end.error)}</Alert>}
        {ended.length > 0 && (
          <>
            <UnstyledButton mih={44} onClick={() => setShowEnded((v) => !v)} aria-expanded={showEnded} className={classes.toggle}>
              <Group gap="xs">
                <IconChevronDown size={16} className={showEnded ? classes.open : undefined} />
                <Text size="sm" fw={600}>
                  {t('doctor.orders.ended')}
                </Text>
                <Badge color="grey" variant="light" size="sm">
                  {ended.length}
                </Badge>
              </Group>
            </UnstyledButton>
            <Collapse in={showEnded}>
              <Stack gap="xs">
                {ended.map((o) => (
                  <OrderCard key={o.id} order={o} ended />
                ))}
              </Stack>
            </Collapse>
          </>
        )}
      </Stack>

      <Stack gap="xs">
        <Group gap="xs">
          <ThemeIcon variant="light" color="uoca" size={28} radius="md" aria-hidden>
            <IconNote size={16} />
          </ThemeIcon>
          <Text fw={600}>{t('doctor.notes.title')}</Text>
        </Group>
        {notes.isPending && <Loader size="sm" />}
        {notes.isError && <Alert color="danger">{errorMessage(t, notes.error)}</Alert>}
        {notes.data?.length === 0 && <EmptyState compact icon={IconNote} title={t('doctor.notes.none')} />}
        {shownNotes?.map((n) => (
          <Card key={n.id} padding="sm">
            <Text dir="auto" className={classes.text}>
              {n.text}
            </Text>
            <Text size="sm" c="dimmed" mt={4}>
              {n.author.name} · {formatDay(toLocalDate(new Date(n.at)), i18n.language)}
            </Text>
          </Card>
        ))}
        {(notes.data?.length ?? 0) > NOTES_SHOWN && (
          <Button variant="subtle" mih={44} onClick={() => setAllNotes((v) => !v)}>
            {allNotes ? t('doctor.notes.showFewer') : t('doctor.notes.showAll')}
          </Button>
        )}
      </Stack>

      <Modal opened={writing !== null} onClose={() => setWriting(null)} title={t('doctor.new')}>
        <Stack gap="md">
          <SegmentedControl
            fullWidth
            value={writing ?? 'order'}
            onChange={(v) => setWriting(v as Kind)}
            data={[
              { value: 'order', label: t('doctor.kind.order') },
              { value: 'note', label: t('doctor.kind.note') },
            ]}
          />
          {writing === 'note' ? (
            <NoteForm patientId={patientId} onDone={() => setWriting(null)} />
          ) : (
            <OrderForm patientId={patientId} onDone={() => setWriting(null)} />
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
