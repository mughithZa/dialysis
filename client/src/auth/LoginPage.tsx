import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, PasswordInput, Stack, Text, TextInput, ThemeIcon, Title } from '@mantine/core';
import { IconDroplet, IconLock, IconUser } from '@tabler/icons-react';
import { errorMessage } from '../i18n/errors';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { landingPath } from '../layout/nav';
import { readStoredCentre, resolveCentreId, useAuth } from './AuthProvider';
import classes from './LoginPage.module.css';

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
    <Box className={classes.page}>
      <Box className={classes.brandPanel}>
        <Stack gap="xs" align="center" ta="center" className={classes.brandInner}>
          <ThemeIcon size={64} radius="xl" className={classes.mark} aria-hidden>
            <IconDroplet size={34} stroke={1.8} />
          </ThemeIcon>
          <Text component="p" className={classes.appName}>
            {t('app.name')}
          </Text>
          <Text className={classes.tagline}>{t('app.tagline')}</Text>
        </Stack>
      </Box>
      <Box className={classes.formArea}>
        <Card className={classes.card} padding="lg" shadow="md">
          <form onSubmit={onSubmit}>
            <Stack gap="md">
              <Stack gap={4}>
                <Title order={2}>{t('login.title')}</Title>
                <Text size="sm" c="dimmed">
                  {t('login.subtitle')}
                </Text>
              </Stack>
              {error && (
                <Alert color="danger" role="alert">
                  {error}
                </Alert>
              )}
              <TextInput
                label={t('login.username')}
                autoComplete="username"
                autoCapitalize="none"
                size="md"
                required
                leftSection={<IconUser size={18} aria-hidden />}
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
              />
              <PasswordInput
                label={t('login.password')}
                autoComplete="current-password"
                size="md"
                required
                leftSection={<IconLock size={18} aria-hidden />}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              <Button type="submit" size="md" mih={48} loading={busy} fullWidth>
                {t('login.submit')}
              </Button>
            </Stack>
          </form>
        </Card>
        <Box className={classes.language}>
          <LanguageSwitch />
        </Box>
      </Box>
    </Box>
  );
}
