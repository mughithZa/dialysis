import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Chip, Group, Loader, Modal, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { IconKey, IconPencil, IconSearch, IconUserPlus, IconUserSearch, IconUsers } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { PersonAvatar } from '../../components/PersonAvatar';
import { RowMenu } from '../../components/RowMenu';
import { StateChip } from '../../components/StateChip';
import rows from '../../components/ListRows.module.css';
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

export type UserFilter = 'all' | 'active' | 'inactive';
const FILTERS: UserFilter[] = ['all', 'active', 'inactive'];

/** Users matching the search (name, username or phone) and the active filter. */
export function filterUsers(users: UserRow[], search: string, filter: UserFilter, roleName: (key: string) => string = (k) => k): UserRow[] {
  const q = search.trim().toLocaleLowerCase();
  return users.filter(
    (u) =>
      (filter === 'all' || (filter === 'active') === u.active) &&
      (!q ||
        [u.name, u.username, u.phone ?? '', ...u.roleKeys.map(roleName)].some((f) => f.toLocaleLowerCase().includes(q))),
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
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');

  const roleName = (key: string) => {
    const role = roles.data?.find((r) => r.key === key);
    return role ? roleLabel(t, role) : key;
  };
  const all = users.data ?? [];
  const shown = filterUsers(all, search, filter, roleName);

  return (
    <Stack gap="md">
      <PageHeader
        title={t('centre.users.title')}
        subtitle={users.data ? t('centre.users.count', { count: all.length }) : undefined}
        action={
          canCreate && (
            <Button mih={44} onClick={() => setEditing('new')} leftSection={<IconUserPlus size={18} aria-hidden />}>
              {t('centre.users.new')}
            </Button>
          )
        }
      />
      {all.length > 0 && (
        <>
          <TextInput
            aria-label={t('centre.users.search')}
            placeholder={t('centre.users.search')}
            type="search"
            size="md"
            leftSection={<IconSearch size={18} aria-hidden />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <div role="radiogroup" aria-label={t('centre.users.filter')} className={rows.filters}>
            <Chip.Group value={filter} onChange={(v) => setFilter(v as UserFilter)}>
              {FILTERS.map((f) => (
                <Chip key={f} value={f} size="sm" variant="light">
                  {t(`centre.users.filters.${f}`)}
                </Chip>
              ))}
            </Chip.Group>
          </div>
        </>
      )}
      {users.isPending && <Loader />}
      {users.isError && <Alert color="danger">{errorMessage(t, users.error)}</Alert>}
      {users.data?.length === 0 && (
        <EmptyState
          icon={IconUsers}
          title={t('centre.users.empty')}
          hint={t('empty.usersHint')}
          action={canCreate ? { label: t('centre.users.new'), onClick: () => setEditing('new'), icon: IconUserPlus } : undefined}
        />
      )}
      {all.length > 0 && shown.length === 0 && (
        <EmptyState icon={IconUserSearch} title={t('centre.users.noMatch')} hint={t('centre.users.noMatchHint')} />
      )}
      {shown.length > 0 && (
        <Card padding={0}>
          {shown.map((u) => (
            <div key={u.id} className={rows.row} data-user={u.username}>
              <PersonAvatar name={u.name} size={42} style={u.active ? undefined : { opacity: 0.55 }} />
              <Stack gap={4} className={rows.main}>
                <Group gap={6} wrap="nowrap">
                  <Text fw={600} truncate c={u.active ? undefined : 'dimmed'}>
                    {u.name}
                  </Text>
                  {!u.active && (
                    <StateChip tone="off" size="sm">
                      {t('centre.users.inactive')}
                    </StateChip>
                  )}
                </Group>
                <Text size="sm" c="dimmed" truncate>
                  <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                    {u.username}
                  </span>
                  {u.phone && (
                    <>
                      {' · '}
                      <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
                        {u.phone}
                      </span>
                    </>
                  )}
                </Text>
                {u.roleKeys.length > 0 && (
                  <Group gap={4}>
                    {u.roleKeys.map((k) => (
                      <StateChip key={k} tone="info" size="sm">
                        {roleName(k)}
                      </StateChip>
                    ))}
                  </Group>
                )}
              </Stack>
              <RowMenu
                label={t('centre.users.menu', { name: u.name })}
                items={[
                  canEdit && { label: t('common.edit'), icon: IconPencil, onClick: () => setEditing(u) },
                  canReset && { label: t('centre.users.resetPassword'), icon: IconKey, onClick: () => setResetting(u) },
                ]}
              />
            </div>
          ))}
        </Card>
      )}
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
