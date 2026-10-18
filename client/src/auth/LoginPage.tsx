import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Center, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core';
import { errorMessage } from '../i18n/errors';
import { landingPath } from '../layout/nav';
import { readStoredCentre, resolveCentreId, useAuth } from './AuthProvider';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await login(username, password);
      navigate(landingPath(me, resolveCentreId(me, readStoredCentre())), { replace: true });
    } catch (err) {
      setError(errorMessage(t, err));
      setBusy(false);
    }
  }

  return (
    <Center mih="100dvh" p="md">
      <Paper withBorder shadow="sm" p="lg" w="100%" maw={400}>
        <form onSubmit={onSubmit}>
          <Stack>
            <Title order={2}>{t('login.title')}</Title>
            {error && (
              <Alert color="danger" role="alert">
                {error}
              </Alert>
            )}
            <TextInput
              label={t('login.username')}
              autoComplete="username"
              size="md"
              required
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
            />
            <PasswordInput
              label={t('login.password')}
              autoComplete="current-password"
              size="md"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Button type="submit" size="md" mih={44} loading={busy}>
              {t('login.submit')}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
