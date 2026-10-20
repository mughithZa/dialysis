import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Group, Loader, Modal, PasswordInput, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconBuildingHospital, IconKey, IconLock, IconLockOpen, IconPlus, IconUserOff, IconUserShield } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { PersonAvatar } from '../../components/PersonAvatar';
import { RowMenu } from '../../components/RowMenu';
import { StateChip } from '../../components/StateChip';
import rows from '../../components/ListRows.module.css';
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
      <Text fw={600}>{t('pm.centres.managers')}</Text>      {managers.isPending && <Loader size="sm" />}
      {managers.isError && <Alert color="danger">{errorMessage(t, managers.error)}</Alert>}
      {managers.data?.length === 0 && <EmptyState compact icon={IconUserOff} title={t('pm.centres.noManagers')} />}
      {managers.data?.map((m) => (
        <Card key={m.id} padding="sm">
        <Stack gap="xs">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="sm" wrap="nowrap" className={rows.main}>
              <PersonAvatar name={m.name} />
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text fw={600} truncate>
                  {m.name}
                </Text>
                <Text size="sm" c="dimmed" truncate>
                  {m.username}
                </Text>
              </Stack>
            </Group>
            <Button
              mih={44}
              variant="light"
              leftSection={<IconKey size={16} aria-hidden />}
              aria-expanded={resetting === m.id}
              onClick={() => { setResetting(resetting === m.id ? null : m.id); setPassword(''); }}
            >
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
        </Card>
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
  const [closing, setClosing] = useState<Centre | null>(null);

  const change = (c: Centre, action: 'close' | 'reopen') =>
    setStatus.mutate(
      { id: c.id, action },
      { onSuccess: () => notifications.show({ message: t(action === 'close' ? 'pm.centres.closedOk' : 'pm.centres.reopenedOk') }) },
    );
  const list = centres.data ?? [];
  const open = list.filter((c) => c.status === 'active').length;

  return (
    <Stack gap="md">
      <PageHeader
        title={t('pm.centres.title')}
        subtitle={centres.data ? t('pm.centres.count', { count: list.length, open }) : undefined}
        action={
          canCreate && (
            <Button mih={44} onClick={() => setCreating(true)} leftSection={<IconPlus size={18} aria-hidden />}>
              {t('pm.centres.new')}
            </Button>
          )
        }
      />
      {centres.isPending && <Loader />}
      {centres.isError && <Alert color="danger">{errorMessage(t, centres.error)}</Alert>}
      {setStatus.isError && <Alert color="danger">{errorMessage(t, setStatus.error)}</Alert>}
      {centres.data?.length === 0 && (
        <EmptyState
          icon={IconBuildingHospital}
          title={t('pm.centres.empty')}
          hint={t('empty.centresHint')}
          action={canCreate ? { label: t('pm.centres.new'), onClick: () => setCreating(true), icon: IconPlus } : undefined}
        />
      )}
      {list.length > 0 && (
        <Card padding={0}>
          {list.map((c) => (
            <div key={c.id} className={rows.row} data-centre={c.name}>
              <ThemeIcon variant="light" color={c.status === 'active' ? 'uoca' : 'grey'} size={42} radius="xl" aria-hidden>
                <IconBuildingHospital size={22} stroke={1.7} />
              </ThemeIcon>
              <Stack gap={2} className={rows.main}>
                <Text fw={600} truncate c={c.status === 'active' ? undefined : 'dimmed'}>
                  {c.name}
                </Text>
                <StateChip tone={c.status === 'active' ? 'on' : 'off'} w="fit-content">
                  {c.status === 'active' ? t('pm.centres.active') : t('pm.centres.closed')}
                </StateChip>
              </Stack>
              <RowMenu
                label={t('pm.centres.menu', { name: c.name })}
                loading={setStatus.isPending && setStatus.variables?.id === c.id}
                items={[
                  canManagers && { label: t('pm.centres.managers'), icon: IconUserShield, onClick: () => setManaging(c) },
                  canClose &&
                    (c.status === 'active'
                      ? { label: t('pm.centres.close'), icon: IconLock, onClick: () => setClosing(c), danger: true }
                      : { label: t('pm.centres.reopen'), icon: IconLockOpen, onClick: () => change(c, 'reopen') }),
                ]}
              />
            </div>
          ))}
        </Card>
      )}
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('pm.centres.new')} fullScreen>
        {creating && <CentreForm onDone={() => setCreating(false)} />}
      </Modal>
      <Modal opened={closing !== null} onClose={() => setClosing(null)} title={t('pm.centres.closeTitle', { name: closing?.name ?? '' })}>
        <Stack gap="md">
          <Text size="sm">{t('pm.centres.closeText')}</Text>
          <Group justify="flex-end">
            <Button variant="default" mih={44} onClick={() => setClosing(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              color="danger"
              mih={44}
              onClick={() => {
                if (closing) change(closing, 'close');
                setClosing(null);
              }}
            >
              {t('pm.centres.close')}
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={managing !== null} onClose={() => setManaging(null)} title={managing?.name} fullScreen>
        {managing && <ManagersPanel centre={managing} />}
      </Modal>
    </Stack>
  );
}
