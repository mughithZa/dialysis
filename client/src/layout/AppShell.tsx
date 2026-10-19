import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  AppShell as MantineAppShell,
  Box,
  Button,
  Drawer,
  Group,
  Select,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { errorMessage } from '../i18n/errors';
import { LanguageSwitch } from '../i18n/LanguageSwitch';
import { useAuth, useCentre } from '../auth/AuthProvider';
import { visibleNav, type VisibleNavItem } from './nav';

const TAB_COUNT = 4;
const TOUCH = 44;

export function AppShell() {
  const { t } = useTranslation();
  const { me, logout } = useAuth();
  const { centreId, setCentreId } = useCentre();
  const navigate = useNavigate();
  const location = useLocation();
  const isPhone = useMediaQuery('(max-width: 48em)') ?? false;
  const [moreOpen, setMoreOpen] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const items = visibleNav(me, centreId);
  const tabs = items.slice(0, TAB_COUNT);
  const rest = items.slice(TAB_COUNT);
  const centres = me?.centres ?? [];

  function switchCentre(next: string | null) {
    if (!next || next === centreId) return;
    const scoped = centreId && location.pathname.startsWith(`/c/${centreId}/`);
    setCentreId(next);
    if (scoped) navigate(location.pathname.replace(`/c/${centreId}/`, `/c/${next}/`));
  }

  const onLogout = async () => {
    setMoreOpen(false);
    setLogoutError(null);
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (err) {
      setLogoutError(errorMessage(t, err));
    }
  };

  const switcher = centres.length > 1 && (
    <Select
      aria-label={t('common.centre')}
      data={centres.map((c) => ({ value: c.id, label: c.name }))}
      value={centreId}
      onChange={switchCentre}
      allowDeselect={false}
      comboboxProps={{ withinPortal: true }}
      size="md"
      w={{ base: 180, sm: 260 }}
    />
  );

  return (
    <MantineAppShell
      header={{ height: 60 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: true } }}
      footer={{ height: 64, collapsed: !isPhone }}
      padding="md"
    >
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Text fw={700} truncate>
            {t('app.name')}
          </Text>
          <Group gap="sm" wrap="nowrap">
            {switcher}
            {!isPhone && (
              <Button variant="subtle" onClick={onLogout} mih={TOUCH}>
                {t('common.logout')}
              </Button>
            )}
          </Group>
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="xs" aria-label={t('common.navigation')} component="nav">
        <Stack gap={4}>
          {items.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
          <Box mt="md">
            <LanguageSwitch />
          </Box>
        </Stack>
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        {logoutError && (
          <Alert color="danger" role="alert" mb="md" withCloseButton onClose={() => setLogoutError(null)}>
            {logoutError}
          </Alert>
        )}
        <Outlet />
      </MantineAppShell.Main>

      <MantineAppShell.Footer component="nav" aria-label={t('common.navigation')}>
        <Group h="100%" grow gap={0} wrap="nowrap">
          {tabs.map((item) => (
            <TabLink key={item.to} item={item} />
          ))}
          <UnstyledButton
            onClick={() => setMoreOpen(true)}
            mih={TOUCH}
            h="100%"
            style={{ display: 'grid', placeItems: 'center' }}
          >
            <Text size="xs">{t('common.more')}</Text>
          </UnstyledButton>
        </Group>
      </MantineAppShell.Footer>

      <Drawer
        opened={moreOpen}
        onClose={() => setMoreOpen(false)}
        position="bottom"
        title={t('common.more')}
        closeButtonProps={{ 'aria-label': t('common.close'), size: 'lg' }}
      >
        <Stack gap={4}>
          {rest.map((item) => (
            <SideLink key={item.to} item={item} onNavigate={() => setMoreOpen(false)} />
          ))}
          <Box mt="sm">
            <LanguageSwitch />
          </Box>
          {me && (
            <Text size="sm" c="dimmed" mt="sm">
              {t('common.signedInAs', { name: me.name })}
            </Text>
          )}
          <Button variant="default" onClick={onLogout} mih={TOUCH} mt="sm">
            {t('common.logout')}
          </Button>
        </Stack>
      </Drawer>
    </MantineAppShell>
  );
}

function SideLink({ item, onNavigate }: { item: VisibleNavItem; onNavigate?: () => void }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        minHeight: TOUCH,
        paddingInline: 'var(--mantine-spacing-sm)',
        borderRadius: 'var(--mantine-radius-md)',
        textDecoration: 'none',
        color: 'inherit',
        fontWeight: isActive ? 700 : 400,
        background: isActive ? 'var(--mantine-color-neutral-0)' : undefined,
      })}
    >
      {t(item.labelKey)}
    </NavLink>
  );
}

function TabLink({ item }: { item: VisibleNavItem }) {
  const { t } = useTranslation();
  return (
    <Box
      component={NavLink}
      to={item.to}
      h="100%"
      mih={TOUCH}
      style={({ isActive }: { isActive: boolean }) => ({
        display: 'grid',
        placeItems: 'center',
        textDecoration: 'none',
        color: 'inherit',
        fontWeight: isActive ? 700 : 400,
        borderBlockStart: isActive ? '3px solid var(--mantine-primary-color-filled)' : '3px solid transparent',
        textAlign: 'center',
        paddingInline: 2,
      })}
    >
      <Text size="xs" fw="inherit" lineClamp={2}>
        {t(item.labelKey)}
      </Text>
    </Box>
  );
}
