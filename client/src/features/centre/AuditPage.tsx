import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Loader, Select, Stack, Text, Title } from '@mantine/core';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useAudit, useCentreUsers } from './api';

export function AuditPage() {
  const { t } = useTranslation();
  const [userId, setUserId] = useState('');
  const canListUsers = useCan('users.create') || useCan('users.edit');
  const users = useCentreUsers(canListUsers);
  const audit = useAudit(userId);

  return (
    <Stack gap="md">
      <Title order={2}>{t('centre.audit.title')}</Title>
      {canListUsers && (
        <Select
          label={t('centre.audit.user')}
          placeholder={t('centre.audit.allUsers')}
          data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
          value={userId || null}
          onChange={(v) => setUserId(v ?? '')}
          clearable
          maw={320}
        />
      )}
      {audit.isPending && <Loader />}
      {audit.isError && <Alert color="danger">{errorMessage(t, audit.error)}</Alert>}
      {audit.data?.length === 0 && <Text c="dimmed">{t('centre.audit.empty')}</Text>}
      {audit.data?.map((r, i) => (
        <Card key={`${r.at}-${i}`} withBorder padding="sm">
          <Stack gap={2}>
            <Text fw={600}>{r.action}</Text>
            <Text size="sm">{r.user.name}</Text>
            <Text size="sm" c="dimmed">
              {new Date(r.at).toLocaleString()}
            </Text>
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
