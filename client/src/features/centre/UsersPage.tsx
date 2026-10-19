import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Group, Loader, Modal, PasswordInput, Stack, Text, Title } from '@mantine/core';
import { IconUsers } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useCentreRoles, useCentreUsers, useResetUserPassword, type UserRow } from './api';
import { roleLabel } from '../../i18n/roleLabel';
import { UserForm } from './UserForm';

function ResetPasswordForm({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const { t } = useTranslation();
  const reset = useResetUserPassword();
  const [password, setPassword] = useState('');
  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (password.length < 8) return;
        reset.mutate(
          { id: user.id, password },
          {
            onSuccess: () => {
              notifications.show({ message: t('centre.users.passwordReset') });
              onDone();
            },
          },
        );
      }}
    >
      <PasswordInput label={t('centre.users.newPassword')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
      {reset.isError && <Alert color="danger">{errorMessage(t, reset.error)}</Alert>}
      <Button type="submit" mih={44} loading={reset.isPending} disabled={password.length < 8}>
        {t('common.save')}
      </Button>
    </Stack>
  );
}

export function UsersPage() {
  const { t } = useTranslation();
  const users = useCentreUsers();
  const roles = useCentreRoles();
  const canCreate = useCan('users.create');
  const canEdit = useCan('users.edit');
  const canReset = useCan('users.resetPassword');
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);

  const roleName = (key: string) => {
    const role = roles.data?.find((r) => r.key === key);
    return role ? roleLabel(t, role) : key;
  };

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{t('centre.users.title')}</Title>
        {canCreate && (
          <Button mih={44} onClick={() => setEditing('new')}>
            {t('centre.users.new')}
          </Button>
        )}
      </Group>
      {users.isPending && <Loader />}
      {users.isError && <Alert color="danger">{errorMessage(t, users.error)}</Alert>}
      {users.data?.length === 0 && <EmptyState icon={IconUsers} title={t('centre.users.empty')} hint={t('empty.usersHint')} />}
      {users.data?.map((u) => (
        <Card key={u.id} withBorder padding="sm" data-user={u.username}>
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={0}>
                <Text fw={600}>{u.name}</Text>
                <Text size="sm" c="dimmed">
                  {u.username}
                  {u.phone ? ` · ${u.phone}` : ''}
                </Text>
              </Stack>
              {!u.active && (
                <Badge color="warning" variant="light">
                  {t('centre.users.inactive')}
                </Badge>
              )}
            </Group>
            <Group gap="xs">
              {u.roleKeys.map((k) => (
                <Badge key={k} variant="light">
                  {roleName(k)}
                </Badge>
              ))}
            </Group>
            {(canEdit || canReset) && (
              <Group>
                {canEdit && (
                  <Button mih={44} variant="default" onClick={() => setEditing(u)}>
                    {t('common.edit')}
                  </Button>
                )}
                {canReset && (
                  <Button mih={44} variant="default" onClick={() => setResetting(u)}>
                    {t('centre.users.resetPassword')}
                  </Button>
                )}
              </Group>
            )}
          </Stack>
        </Card>
      ))}
      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? t('centre.users.new') : t('centre.users.editTitle')}
        fullScreen
      >
        {editing !== null && (
          <UserForm key={editing === 'new' ? 'new' : editing.id} user={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Modal>
      <Modal opened={resetting !== null} onClose={() => setResetting(null)} title={t('centre.users.resetPassword')}>
        {resetting && <ResetPasswordForm key={resetting.id} user={resetting} onDone={() => setResetting(null)} />}
      </Modal>
    </Stack>
  );
}
