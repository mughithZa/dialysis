import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Stack, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useCancelSession, useDidNotCome } from './api';

/** Cancel a scheduled session; the reason is required. Mount with a `key` so each open starts fresh. */
export function CancelDialog({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const cancel = useCancelSession();
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!trimmed) return;
        cancel.mutate(
          { sessionId, reason: trimmed },
          {
            onSuccess: () => {
              notifications.show({ message: t('desk.cancel.done') });
              onDone();
            },
          },
        );
      }}
    >
      <Textarea label={t('desk.cancel.reason')} autosize minRows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      {cancel.isError && <Alert color="danger">{errorMessage(t, cancel.error)}</Alert>}
      <Button type="submit" mih={44} color="danger" loading={cancel.isPending} disabled={!trimmed}>
        {t('desk.cancel.confirm')}
      </Button>
    </Stack>
  );
}

/** Record that the patient did not come (today or a past scheduled session); the reason is optional. */
export function DidNotComeDialog({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const dnc = useDidNotCome();
  const [reason, setReason] = useState('');
  const trimmed = reason.trim();
  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        dnc.mutate(
          { sessionId, ...(trimmed ? { reason: trimmed } : {}) },
          {
            onSuccess: () => {
              notifications.show({ message: t('desk.didNotCome.done') });
              onDone();
            },
          },
        );
      }}
    >
      <Textarea label={t('desk.didNotCome.reason')} autosize minRows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      {dnc.isError && <Alert color="danger">{errorMessage(t, dnc.error)}</Alert>}
      <Button type="submit" mih={44} loading={dnc.isPending}>
        {t('desk.didNotCome.confirm')}
      </Button>
    </Stack>
  );
}
