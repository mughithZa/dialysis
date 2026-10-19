import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Card, Group, Loader, Modal, Stack, Tabs, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { useCentreId } from '../centre/api';
import { errorMessage } from '../../i18n/errors';
import { formatDate } from '../../i18n/format';
import { toLocalDate } from './dates';
import { useTransferAction, useTransfers, type IncomingTransfer, type OutgoingTransfer } from './api';

const date = (iso: string) => formatDate(toLocalDate(new Date(iso)));

function RejectForm({ transfer, onDone }: { transfer: IncomingTransfer; onDone: () => void }) {
  const { t } = useTranslation();
  const action = useTransferAction();
  const [reason, setReason] = useState('');
  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!reason.trim()) return;
        action.mutate(
          { id: transfer.id, action: 'reject', reason: reason.trim() },
          {
            onSuccess: () => {
              notifications.show({ message: t('desk.transfers.rejected') });
              onDone();
            },
          },
        );
      }}
    >
      <Text>{transfer.patient.name}</Text>
      <Textarea label={t('desk.transfers.reason')} autosize minRows={2} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      {action.isError && <Alert color="danger">{errorMessage(t, action.error)}</Alert>}
      <Button type="submit" mih={44} color="danger" loading={action.isPending} disabled={!reason.trim()}>
        {t('desk.transfers.confirmReject')}
      </Button>
    </Stack>
  );
}

function StatusBadge({ status }: { status: IncomingTransfer['status'] }) {
  const { t } = useTranslation();
  return (
    <Badge variant="light" color={status === 'pending' ? 'warning' : status === 'rejected' ? 'danger' : 'neutral'}>
      {t(`desk.transfers.status.${status}`)}
    </Badge>
  );
}

function Incoming() {
  const { t } = useTranslation();
  const list = useTransfers('incoming', true);
  const action = useTransferAction();
  const [rejecting, setRejecting] = useState<IncomingTransfer | null>(null);

  return (
    <Stack gap="sm">
      {list.isPending && <Loader />}
      {list.isError && <Alert color="danger">{errorMessage(t, list.error)}</Alert>}
      {action.isError && <Alert color="danger">{errorMessage(t, action.error)}</Alert>}
      {list.data?.length === 0 && <Text c="dimmed">{t('desk.transfers.empty')}</Text>}
      {list.data?.map((tr) => (
        <Card key={tr.id} withBorder padding="sm">
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Stack gap={0}>
                <Text fw={600}>{tr.patient.name}</Text>
                <Text size="sm" c="dimmed">
                  {t('desk.transfers.from', { centre: tr.fromCentre.name })} · {t('desk.transfers.sent', { date: date(tr.sentAt) })}
                </Text>
                {tr.patient.phone && <Text size="sm">{tr.patient.phone}</Text>}
                {tr.patient.kidneyFailureCause && <Text size="sm">{t('desk.transfers.kidney', { cause: tr.patient.kidneyFailureCause })}</Text>}
                {tr.note && <Text size="sm">{tr.note}</Text>}
              </Stack>
              <StatusBadge status={tr.status} />
            </Group>
            {tr.status === 'pending' && (
              <Group>
                <Button
                  mih={44}
                  loading={action.isPending && action.variables?.id === tr.id && action.variables.action === 'accept'}
                  onClick={() =>
                    action.mutate(
                      { id: tr.id, action: 'accept' },
                      { onSuccess: () => notifications.show({ message: t('desk.transfers.accepted') }) },
                    )
                  }
                >
                  {t('desk.transfers.accept')}
                </Button>
                <Button mih={44} variant="default" onClick={() => setRejecting(tr)}>
                  {t('desk.transfers.reject')}
                </Button>
              </Group>
            )}
          </Stack>
        </Card>
      ))}
      <Modal opened={rejecting !== null} onClose={() => setRejecting(null)} title={t('desk.transfers.rejectTitle')}>
        {rejecting && <RejectForm key={rejecting.id} transfer={rejecting} onDone={() => setRejecting(null)} />}
      </Modal>
    </Stack>
  );
}

function Outgoing({ canCancel }: { canCancel: boolean }) {
  const { t } = useTranslation();
  const centreId = useCentreId();
  const list = useTransfers('outgoing', true);
  const action = useTransferAction();
  return (
    <Stack gap="sm">
      {list.isPending && <Loader />}
      {list.isError && <Alert color="danger">{errorMessage(t, list.error)}</Alert>}
      {action.isError && <Alert color="danger">{errorMessage(t, action.error)}</Alert>}
      {list.data?.length === 0 && <Text c="dimmed">{t('desk.transfers.empty')}</Text>}
      {(list.data as OutgoingTransfer[] | undefined)?.map((tr) => (
        <Card key={tr.id} withBorder padding="sm">
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <Stack gap={0}>
                {tr.patient && (
                  <Anchor component={Link} to={`/c/${centreId}/patients/${tr.patient.id}`} fw={600} mih={44} display="inline-flex" style={{ alignItems: 'center' }}>
                    {tr.patient.name}
                  </Anchor>
                )}
                <Text fw={tr.patient ? undefined : 600}>{t('desk.transfers.to', { centre: tr.toCentre.name })}</Text>
                <Text size="sm" c="dimmed">
                  {t('desk.transfers.sent', { date: date(tr.sentAt) })}
                </Text>
                {tr.note && <Text size="sm">{tr.note}</Text>}
                {tr.rejectReason && <Text size="sm">{t('desk.transfers.rejectReason', { reason: tr.rejectReason })}</Text>}
              </Stack>
              <StatusBadge status={tr.status} />
            </Group>
            {canCancel && tr.status === 'pending' && (
              <Group>
                <Button
                  mih={44}
                  variant="default"
                  loading={action.isPending && action.variables?.id === tr.id}
                  onClick={() =>
                    action.mutate(
                      { id: tr.id, action: 'cancel' },
                      { onSuccess: () => notifications.show({ message: t('desk.transfers.cancelled') }) },
                    )
                  }
                >
                  {t('desk.transfers.cancel')}
                </Button>
              </Group>
            )}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

export function TransfersPage() {
  const { t } = useTranslation();
  const canDecide = useCan('transfers.decide');
  const canSend = useCan('transfers.send');
  // Permissions can arrive after first render, so the default tab is derived rather than fixed.
  const [tab, setTab] = useState<string | null>(null);
  const current = tab ?? (canDecide ? 'incoming' : 'outgoing');
  return (
    <Stack gap="md">
      <Title order={2}>{t('desk.transfers.title')}</Title>
      <Tabs value={current} onChange={setTab} keepMounted={false}>
        <Tabs.List grow>
          {canDecide && <Tabs.Tab value="incoming" mih={44}>{t('desk.transfers.incoming')}</Tabs.Tab>}
          {canSend && <Tabs.Tab value="outgoing" mih={44}>{t('desk.transfers.outgoing')}</Tabs.Tab>}
        </Tabs.List>
        {canDecide && (
          <Tabs.Panel value="incoming" pt="md">
            <Incoming />
          </Tabs.Panel>
        )}
        {canSend && (
          <Tabs.Panel value="outgoing" pt="md">
            <Outgoing canCancel={canSend} />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}
