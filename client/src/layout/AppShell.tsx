import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Alert, AppShell as MantineAppShell, Box, Drawer, Group, Select, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconDots, IconDroplet, IconSelector } from '@tabler/icons-react';
import { errorMessage } from '../i18n/errors';
import { useAuth, useCentre } from '../auth/AuthProvider';
import { splitTabs, visibleNav, type VisibleNavItem } from './nav';
import { UserMenu } from './UserMenu';
import classes from './AppShell.module.css';

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
  const { tabs, rest } = splitTabs(items);
  const centres = me?.centres ?? [];
  const centreName = centres.find((c) => c.id === centreId)?.name;
  const showFooter = isPhone && items.length > 1;

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

  return (
    <MantineAppShell
      header={{ height: 64 }}
      navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: true } }}
      footer={showFooter ? { height: 68 } : undefined}
      padding="md"
    >
      <MantineAppShell.Header className={classes.header} withBorder={false}>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <ThemeIcon size={36} radius="xl" className={classes.mark} aria-hidden>
              <IconDroplet size={20} stroke={2} />
            </ThemeIcon>
            <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
              <Text size="xs" className={classes.brand} truncate>
                {t('app.name')}
              </Text>
              {centres.length > 1 ? (
                <Select
                  aria-label={t('common.centre')}
                  data={centres.map((c) => ({ value: c.id, label: c.name }))}
                  value={centreId}
                  onChange={switchCentre}
                  allowDeselect={false}
                  comboboxProps={{ withinPortal: true }}
                  variant="unstyled"
                  rightSection={<IconSelector size={16} />}
                  rightSectionPointerEvents="none"
                  classNames={{ input: classes.centreSelect, section: classes.centreSection }}
                  maw={280}
                />
              ) : (
                <Text fw={700} size="md" truncate className={classes.title}>
                  {centreName ?? t('app.tagline')}
                </Text>
              )}
            </Stack>
          </Group>
          <UserMenu onLogout={onLogout} />
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar p="sm" aria-label={t('common.navigation')} component="nav" className={classes.navbar}>
        <Stack gap={4}>
          {items.map((item) => (
            <SideLink key={item.to} item={item} />
          ))}
        </Stack>
      </MantineAppShell.Navbar>

      <MantineAppShell.Main>
        <Box maw={1040} mx="auto">
          {logoutError && (
            <Alert color="danger" role="alert" mb="md" withCloseButton onClose={() => setLogoutError(null)}>
              {logoutError}
            </Alert>
          )}
          <Outlet />
        </Box>
      </MantineAppShell.Main>

      {showFooter && (
        <MantineAppShell.Footer component="nav" aria-label={t('common.navigation')} className={classes.footer}>
          <Group h="100%" grow gap={0} wrap="nowrap" align="stretch">
            {tabs.map((item) => (
              <TabLink key={item.to} item={item} />
            ))}
            {rest.length > 0 && (
              <UnstyledButton onClick={() => setMoreOpen(true)} mih={TOUCH} className={classes.tab} aria-haspopup="dialog">
                <span className={classes.tabIcon}>
                  <IconDots size={22} stroke={1.8} aria-hidden />
                </span>
                <span className={classes.tabLabel}>{t('common.more')}</span>
              </UnstyledButton>
            )}
          </Group>
        </MantineAppShell.Footer>
      )}

      <Drawer
        opened={moreOpen}
        onClose={() => setMoreOpen(false)}
        position="bottom"
        size="auto"
        title={t('common.more')}
        classNames={{ content: classes.sheet, header: classes.sheetHeader, title: classes.sheetTitle }}
        closeButtonProps={{ 'aria-label': t('common.close'), size: 'lg' }}
      >
        <Stack gap={4} pb="md">
          {rest.map((item) => (
            <SideLink key={item.to} item={item} onNavigate={() => setMoreOpen(false)} />
          ))}
        </Stack>
      </Drawer>
    </MantineAppShell>
  );
}

function SideLink({ item, onNavigate }: { item: VisibleNavItem; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <NavLink to={item.to} onClick={onNavigate} className={({ isActive }) => `${classes.sideLink}${isActive ? ` ${classes.active}` : ''}`}>
      <Icon size={22} stroke={1.7} aria-hidden />
      <span>{t(item.labelKey)}</span>
    </NavLink>
  );
}

function TabLink({ item }: { item: VisibleNavItem }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  return (
    <NavLink to={item.to} className={({ isActive }) => `${classes.tab}${isActive ? ` ${classes.active}` : ''}`}>
      <span className={classes.tabIcon}>
        <Icon size={22} stroke={1.8} aria-hidden />
      </span>
      <span className={classes.tabLabel}>{t(item.shortKey)}</span>
    </NavLink>
  );
}
