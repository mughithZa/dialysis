import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Center, Loader, Text } from '@mantine/core';
import { AuthProvider, useAuth, useCentre } from './auth/AuthProvider';
import { LoginPage } from './auth/LoginPage';
import { AppShell } from './layout/AppShell';
import { landingPath, visibleNav } from './layout/nav';
import { CatalogPage } from './features/pm/CatalogPage';
import { CentresPage } from './features/pm/CentresPage';
import { DashboardPage } from './features/pm/DashboardPage';
import { MePage } from './features/me/MePage';
import { PatientsPage } from './features/patients/PatientsPage';
import { RolesPage } from './features/pm/RolesPage';
import { SchedulePage } from './features/schedule/SchedulePage';
import { AuditPage } from './features/centre/AuditPage';
import { SettingsPage } from './features/centre/SettingsPage';
import { SetupPage } from './features/centre/SetupPage';
import { CentreStatsPage } from './features/centre/CentreStatsPage';
import { TodayPage } from './features/sessions/TodayPage';
import { TransfersPage } from './features/transfers/TransfersPage';
import { UsersPage } from './features/centre/UsersPage';

/** Route pattern -> screen. Patterns must match `NAV_ITEMS[].path`. Later tasks swap in real screens. */
const SCREENS: Record<string, ReactElement> = {
  '/centres': <CentresPage />,
  '/roles': <RolesPage />,
  '/catalog': <CatalogPage />,
  '/dashboard': <DashboardPage />,
  '/c/:centreId/today': <TodayPage />,
  '/c/:centreId/patients': <PatientsPage />,
  '/c/:centreId/schedule': <SchedulePage />,
  '/c/:centreId/transfers': <TransfersPage />,
  '/c/:centreId/users': <UsersPage />,
  '/c/:centreId/setup': <SetupPage />,
  '/c/:centreId/settings': <SettingsPage />,
  '/c/:centreId/audit': <AuditPage />,
  '/c/:centreId/stats': <CentreStatsPage />,
  '/me': <MePage />,
};

function Spinner() {
  return (
    <Center mih="100dvh">
      <Loader />
    </Center>
  );
}

function RequireAuth() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  return <AppShell />;
}

function LoginRoute() {
  const { me, loading } = useAuth();
  const { centreId } = useCentre();
  if (loading) return <Spinner />;
  if (me) return <Navigate to={landingPath(me, centreId)} replace />;
  return <LoginPage />;
}

function Home() {
  const { me } = useAuth();
  const { centreId } = useCentre();
  const { t } = useTranslation();
  if (!me) return null;
  if (visibleNav(me, centreId).length === 0) return <Text c="dimmed">{t('common.noAccess')}</Text>;
  return <Navigate to={landingPath(me, centreId)} replace />;
}

/** Renders a screen only if the user may see its nav item; keeps the current centre in sync with the URL. */
function Guard({ pattern, children }: { pattern: string; children: ReactElement }) {
  const { me } = useAuth();
  const { centreId, setCentreId } = useCentre();
  const urlCentre = useParams().centreId ?? null;
  const scopeCentre = urlCentre ?? centreId;

  useEffect(() => {
    if (urlCentre && urlCentre !== centreId && me?.centres.some((c) => c.id === urlCentre)) setCentreId(urlCentre);
  }, [urlCentre, centreId, me, setCentreId]);

  const allowed = visibleNav(me, scopeCentre).some((i) => i.path === pattern);
  return allowed ? children : <Navigate to="/" replace />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginRoute />} />
      <Route element={<RequireAuth />}>
        <Route index element={<Home />} />
        {Object.entries(SCREENS).map(([pattern, screen]) => (
          <Route key={pattern} path={pattern} element={<Guard pattern={pattern}>{screen}</Guard>} />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
