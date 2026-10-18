import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Checkbox, Divider, Group, Loader, PasswordInput, Stack, Switch, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import {
  useCentreRoles,
  useCreateUser,
  useEditUser,
  useLinkDoctor,
  useLookupDoctor,
  type UserRow,
} from './api';

interface Props {
  /** null creates a new user (and offers linking an existing doctor). */
  user: UserRow | null;
  onDone: () => void;
}

export function UserForm({ user, onDone }: Props) {
  const { t } = useTranslation();
  const canCreate = useCan('users.create');
  const canAssign = useCan('roles.assign');
  const roles = useCentreRoles();
  const create = useCreateUser();
  const edit = useEditUser();
  const lookup = useLookupDoctor();
  const link = useLinkDoctor();

  const [name, setName] = useState(user?.name ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [active, setActive] = useState(user?.active ?? true);
  const [roleKeys, setRoleKeys] = useState<string[]>(user?.roleKeys ?? []);
  const [doctorPhone, setDoctorPhone] = useState('');

  const showRoles = user ? canAssign : true;
  const valid = user
    ? name.trim().length > 0
    : name.trim() && username.trim() && password.length >= 8 && roleKeys.length > 0;
  const mutation = user ? edit : create;

  const done = (messageKey: string) => {
    notifications.show({ message: t(messageKey) });
    onDone();
  };

  const submit = () => {
    if (user) {
      edit.mutate(
        { id: user.id, name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}), active, ...(canAssign ? { roleKeys } : {}) },
        { onSuccess: () => done('centre.users.saved') },
      );
    } else {
      create.mutate(
        { name: name.trim(), username: username.trim(), password, ...(phone.trim() ? { phone: phone.trim() } : {}), roleKeys },
        { onSuccess: () => done('centre.users.created') },
      );
    }
  };

  return (
    <Stack gap="md">
      <Stack
        gap="sm"
        component="form"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (valid) submit();
        }}
      >
        <TextInput label={t('centre.users.fullName')} value={name} onChange={(e) => setName(e.currentTarget.value)} required />
        {!user && (
          <>
            <TextInput label={t('centre.users.username')} value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoCapitalize="none" required />
            <PasswordInput label={t('centre.users.password')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
          </>
        )}
        <TextInput label={t('centre.users.phone')} value={phone} onChange={(e) => setPhone(e.currentTarget.value)} type="tel" />
        {user && <Switch size="md" label={t('centre.users.active')} checked={active} onChange={(e) => setActive(e.currentTarget.checked)} />}
        {showRoles && (
          <>
            {roles.isPending && <Loader size="sm" />}
            {roles.isError && <Alert color="danger">{errorMessage(t, roles.error)}</Alert>}
            {roles.data && (
              <Checkbox.Group label={t('centre.users.roles')} value={roleKeys} onChange={setRoleKeys}>
                <Stack gap="xs" mt="xs">
                  {roles.data.map((r) => (
                    <Checkbox key={r.key} value={r.key} label={r.name} size="md" />
                  ))}
                </Stack>
              </Checkbox.Group>
            )}
          </>
        )}
        {mutation.isError && <Alert color="danger">{errorMessage(t, mutation.error)}</Alert>}
        <Button type="submit" mih={44} loading={mutation.isPending} disabled={!valid}>
          {user ? t('common.save') : t('common.create')}
        </Button>
      </Stack>

      {!user && canCreate && (
        <>
          <Divider label={t('centre.users.linkSection')} />
          <Card withBorder padding="sm">
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                {t('centre.users.linkHint')}
              </Text>
              <Group align="flex-end" wrap="nowrap">
                <TextInput
                  style={{ flex: 1 }}
                  label={t('centre.users.doctorPhone')}
                  value={doctorPhone}
                  onChange={(e) => setDoctorPhone(e.currentTarget.value)}
                  type="tel"
                />
                <Button mih={44} variant="default" loading={lookup.isPending} disabled={!doctorPhone.trim()} onClick={() => lookup.mutate(doctorPhone.trim())}>
                  {t('centre.users.find')}
                </Button>
              </Group>
              {lookup.isError && <Alert color="danger">{errorMessage(t, lookup.error)}</Alert>}
              {lookup.data?.length === 0 && <Text c="dimmed">{t('centre.users.noDoctor')}</Text>}
              {lookup.data?.map((d) => (
                <Group key={d.id} justify="space-between" wrap="nowrap">
                  <Text>{d.name}</Text>
                  <Button
                    mih={44}
                    loading={link.isPending && link.variables?.id === d.id}
                    disabled={roleKeys.length === 0}
                    onClick={() => link.mutate({ id: d.id, roleKeys }, { onSuccess: () => done('centre.users.linked') })}
                  >
                    {t('centre.users.link')}
                  </Button>
                </Group>
              ))}
              {lookup.data && lookup.data.length > 0 && roleKeys.length === 0 && <Text size="sm" c="dimmed">{t('centre.users.pickRoles')}</Text>}
              {link.isError && <Alert color="danger">{errorMessage(t, link.error)}</Alert>}
            </Stack>
          </Card>
        </>
      )}
    </Stack>
  );
}
