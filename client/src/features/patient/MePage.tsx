import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Group, Loader, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import {
  IconBell,
  IconBellOff,
  IconBellRinging,
  IconBuildingHospital,
  IconCalendarOff,
  IconClipboardText,
  IconClock,
  IconHeartbeat,
  IconArmchair,
} from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { Timeline } from '../../components/Timeline';
import { formatDay, useTimeline, type TimelineData } from '../../components/timelineApi';
import { shiftDate, todayLocal } from '../desk/dates';
import { errorMessage } from '../../i18n/errors';
import { useOverview, type MiniSession } from './api';
import { InstallPrompt } from './InstallPrompt';
import { formatDate, timeRange } from '../../i18n/format';
import { useNotifications } from './useNotifications';
import classes from './MePage.module.css';

/** A titled card with an icon at the start, for the patient app's prompts. */
function PromptCard({ icon, color = 'uoca', title, children, testId }: { icon: ReactNode; color?: string; title: string; children?: ReactNode; testId?: string }) {
  return (
    <Card padding="md" data-testid={testId}>
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <ThemeIcon variant="light" color={color} size={40} radius="xl" aria-hidden>
          {icon}
        </ThemeIcon>
        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600}>{title}</Text>
          {children}
        </Stack>
      </Group>
    </Card>
  );
}

export function Reminders() {
  const { t } = useTranslation();
  const { status, enable } = useNotifications();
  const [failed, setFailed] = useState(false);
  if (status === 'loading' || status === 'hidden') return null;
  if (status === 'denied')
    return (
      <PromptCard testId="reminders" icon={<IconBellOff size={22} />} color="amber" title={t('me.notify.blockedTitle')}>
        <Text size="sm">{t('me.notify.blockedHow')}</Text>
      </PromptCard>
    );
  if (status === 'on')
    return (
      <PromptCard testId="reminders" icon={<IconBellRinging size={22} />} color="success" title={t('me.notify.on')}>
        <Text size="sm" c="dimmed">
          {t('me.notify.onHint')}
        </Text>
      </PromptCard>
    );
  return (
    <PromptCard testId="reminders" icon={<IconBell size={22} />} title={t('me.notify.title')}>
      <Text size="sm" c="dimmed">
        {t('me.notify.hint')}
      </Text>
      <Button
        mih={44}
        mt={4}
        leftSection={<IconBell size={18} />}
        onClick={() => {
          setFailed(false);
          enable().catch(() => setFailed(true));
        }}
      >
        {t('me.notify.enable')}
      </Button>
      {failed && (
        <Text size="sm" c="danger" role="alert">
          {t('me.notify.failed')}
        </Text>
      )}
    </PromptCard>
  );
}

/** The doctor's orders in force, once (each session row used to repeat them). Present only when the centre shares notes. */
export function activeOrders(d: TimelineData | undefined): { text: string; from: string }[] {
  if (!d) return [];
  const seen = new Map<string, { text: string; from: string }>();
  for (const item of [...d.today, ...d.upcoming, ...d.past]) for (const o of item.orders ?? []) seen.set(`${o.from}\u0000${o.text}`, o);
  return [...seen.values()].sort((a, b) => a.from.localeCompare(b.from));
}

function OrdersCard() {
  const { t } = useTranslation();
  const q = useTimeline({ kind: 'me' });
  const orders = activeOrders(q.data);
  if (orders.length === 0) return null;
  return (
    <Card padding="md" styles={{ root: { borderInlineStart: '4px solid var(--mantine-color-amber-5)' } }} data-testid="my-orders">
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap">
          <ThemeIcon variant="light" color="amber" size={32} radius="md" aria-hidden>
            <IconClipboardText size={18} />
          </ThemeIcon>
          <Title order={4}>{t('me.orders.title')}</Title>
        </Group>
        {orders.map((o, i) => (
          <div key={i} className={classes.order}>
            <Text dir="auto" className={classes.orderText}>
              {o.text}
            </Text>
            <Text size="xs" c="dimmed">
              {t('me.orders.from', { date: formatDate(o.from) })}
            </Text>
          </div>
        ))}
      </Stack>
    </Card>
  );
}

function dayLabel(date: string, lng: string, t: (k: string) => string): string {
  const today = todayLocal();
  if (date === today) return t('me.today');
  if (date === shiftDate(today, 1)) return t('me.tomorrow');
  return formatDay(date, lng);
}

const HERO_NEXT = { backgroundColor: 'var(--uoca-brown)', borderColor: 'var(--uoca-brown)', color: 'var(--uoca-on-brown)' };
const HERO_ACTIVE = { backgroundColor: 'var(--mantine-color-success-7)', borderColor: 'var(--mantine-color-success-7)', color: 'var(--uoca-surface)' };

/** The big card at the top: the session running now, or the next one. */
function Hero({ session, active }: { session: MiniSession; active: boolean }) {
  const { t, i18n } = useTranslation();
  const title = active ? t('me.activeNow') : t('me.next');
  return (
    <Card
      padding="lg"
      // the theme's Card styles are inline (white surface), so the hero colours go through `styles`
      styles={{ root: active ? HERO_ACTIVE : HERO_NEXT }}
      className={active ? undefined : classes.hero}
      role="status" aria-label={title} data-hero={active ? 'active' : 'next'}>
      <Stack gap="xs">
        <Group gap="xs" wrap="nowrap">
          {active ? <IconHeartbeat size={18} aria-hidden /> : <IconClock size={18} aria-hidden />}
          <Text size="sm" fw={600} className={classes.heroLabel}>
            {title}
          </Text>
        </Group>
        <Text fz={26} fw={700} lh={1.2}>
          {active ? formatDay(session.date, i18n.language) : dayLabel(session.date, i18n.language, t)}
        </Text>
        {!active && session.date === todayLocal() && (
          <Text size="sm" className={classes.heroLabel}>
            {formatDay(session.date, i18n.language)}
          </Text>
        )}
        <Text fz={20} fw={600}>
          {timeRange(session.start, session.end)}
        </Text>
        <Group gap="md" mt={4} className={classes.heroMeta}>
          {session.chairLabel && (
            <Group gap={6} wrap="nowrap">
              <IconArmchair size={16} aria-hidden />
              <Text size="sm">{t('timeline.machine', { label: session.chairLabel })}</Text>
            </Group>
          )}
          <Group gap={6} wrap="nowrap">
            <IconBuildingHospital size={16} aria-hidden />
            <Text size="sm">{session.centreName}</Text>
          </Group>
        </Group>
        {active && <Text size="sm">{t('me.activeHint')}</Text>}
      </Stack>
    </Card>
  );
}

export function MePage() {
  const { t } = useTranslation();
  const q = useOverview();

  if (q.isPending) return <Loader />;
  if (q.isError) return <Alert color="danger">{errorMessage(t, q.error)}</Alert>;
  const { active, patient, centre, upcoming } = q.data;
  const next = active ? undefined : upcoming[0];

  return (
    <Stack gap="md">
      <div>
        <Title order={2}>{patient.name}</Title>
        <Text c="dimmed">{centre.name}</Text>
      </div>
      {active && <Hero session={active} active />}
      {next && <Hero session={next} active={false} />}
      {!active && !next && (
        <Card padding="md">
          <EmptyState compact icon={IconCalendarOff} title={t('me.noNext')} hint={t('me.noNextHint')} />
        </Card>
      )}
      <OrdersCard />
      <Reminders />
      <InstallPrompt />
      <Timeline source={{ kind: 'me' }} />
    </Stack>
  );
}
