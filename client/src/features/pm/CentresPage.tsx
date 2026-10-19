import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Group, Loader, Modal, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { IconBuildingHospital, IconUserOff } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useCentres, useManagers, useResetManagerPassword, useSetCentreStatus, type Centre } from './api';
import { CentreForm } from './CentreForm';

function ManagersPanel({ centre }: { centre: Centre }) {
  const { t } = useTranslation();
  const managers = useManagers(centre.id, true);
  const reset = useResetManagerPassword(centre.id);
  const [resetting, setResetting] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  return (
    <Stack gap="xs">
      <Text fw={600}>{t('pm.centres.managers')}</Text>
      {managers.isPending && <Loader size="sm" />}
      {managers.isError && <Alert color="danger">{errorMessage(t, managers.error)}</Alert>}
      {managers.data?.length === 0 && <EmptyState compact icon={IconUserOff} title={t('pm.centres.noManagers')} />}
      {managers.data?.map((m) => (
        <Stack key={m.id} gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Text>
              {m.name} ({m.username})
            </Text>
            <Button mih={44} variant="default" onClick={() => { setResetting(resetting === m.id ? null : m.id); setPassword(''); }}>
              {t('pm.centres.resetPassword')}
            </Button>
          </Group>
          {resetting === m.id && (
            <Stack
              gap="xs"
              component="form"
              onSubmit={(e: React.FormEvent) => {
                e.preventDefault();
                reset.mutate(
                  { userId: m.id, password },
                  {
                    onSuccess: () => {
                      notifications.show({ message: t('pm.centres.passwordReset') });
                      setResetting(null);
                      setPassword('');
                    },
                  },
                );
              }}
            >
              <PasswordInput label={t('pm.centres.newPassword')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
              {reset.isError && <Alert color="danger">{errorMessage(t, reset.error)}</Alert>}
              <Button type="submit" mih={44} loading={reset.isPending} disabled={password.length < 8}>
                {t('common.save')}
              </Button>
            </Stack>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

export function CentresPage() {
  const { t } = useTranslation();
  const centres = useCentres();
  const setStatus = useSetCentreStatus();
  const canCreate = useCan('centres.create');
  const canClose = useCan('centres.close');
  const canManagers = useCan('managers.manage');
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState<Centre | null>(null);

  const change = (c: Centre, action: 'close' | 'reopen') =>
    setStatus.mutate(
      { id: c.id, action },
      { onSuccess: () => notifications.show({ message: t(action === 'close' ? 'pm.centres.closedOk' : 'pm.centres.reopenedOk') }) },
    );

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{t('pm.centres.title')}</Title>
        {canCreate && (
          <Button mih={44} onClick={() => setCreating(true)}>
            {t('pm.centres.new')}
          </Button>
        )}
      </Group>
      {centres.isPending && <Loader />}
      {centres.isError && <Alert color="danger">{errorMessage(t, centres.error)}</Alert>}
      {setStatus.isError && <Alert color="danger">{errorMessage(t, setStatus.error)}</Alert>}
      {centres.data?.length === 0 && <EmptyState icon={IconBuildingHospital} title={t('pm.centres.empty')} hint={t('empty.centresHint')} />}
      {centres.data?.map((c) => (
        <Card key={c.id} withBorder padding="sm">
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={600}>{c.name}</Text>
              <Badge color={c.status === 'active' ? 'neutral' : 'warning'} variant="light">
                {c.status === 'active' ? t('pm.centres.active') : t('pm.centres.closed')}
              </Badge>
            </Group>
            <Group>
              {canClose && (
                <Button
                  mih={44}
                  variant="default"
                  loading={setStatus.isPending && setStatus.variables?.id === c.id}
                  onClick={() => change(c, c.status === 'active' ? 'close' : 'reopen')}
                >
                  {c.status === 'active' ? t('pm.centres.close') : t('pm.centres.reopen')}
                </Button>
              )}
              {canManagers && (
                <Button mih={44} variant="default" onClick={() => setManaging(c)}>
                  {t('pm.centres.managers')}
                </Button>
              )}
            </Group>
          </Stack>
        </Card>
      ))}
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('pm.centres.new')} fullScreen>
        {creating && <CentreForm onDone={() => setCreating(false)} />}
      </Modal>
      <Modal opened={managing !== null} onClose={() => setManaging(null)} title={managing?.name} fullScreen>
        {managing && <ManagersPanel centre={managing} />}
      </Modal>
    </Stack>
  );
}
