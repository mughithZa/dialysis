import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useCreateCentre } from './api';

export function CentreForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const create = useCreateCentre();
  const [name, setName] = useState('');
  const [mName, setMName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');

  const valid = name.trim() && mName.trim() && username.trim() && password.length >= 8;

  const submit = () =>
    create.mutate(
      {
        name: name.trim(),
        manager: { name: mName.trim(), username: username.trim(), password, ...(phone.trim() ? { phone: phone.trim() } : {}) },
      },
      {
        onSuccess: () => {
          notifications.show({ message: t('pm.centres.created') });
          onDone();
        },
      },
    );

  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (valid) submit();
      }}
    >
      <TextInput label={t('pm.centres.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} required />
      <Text fw={600}>{t('pm.centres.managerSection')}</Text>
      <TextInput label={t('pm.centres.managerName')} value={mName} onChange={(e) => setMName(e.currentTarget.value)} required />
      <TextInput label={t('pm.centres.managerUsername')} value={username} onChange={(e) => setUsername(e.currentTarget.value)} autoCapitalize="none" required />
      <PasswordInput label={t('pm.centres.managerPassword')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} required />
      <TextInput label={t('pm.centres.managerPhone')} value={phone} onChange={(e) => setPhone(e.currentTarget.value)} type="tel" />
      {create.isError && <Alert color="danger">{errorMessage(t, create.error)}</Alert>}
      <Button type="submit" mih={44} loading={create.isPending} disabled={!valid}>
        {t('common.create')}
      </Button>
    </Stack>
  );
}
