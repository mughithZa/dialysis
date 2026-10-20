import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Alert, Card, Group, Loader, Select, SimpleGrid, Stack, Text, TextInput, ThemeIcon } from '@mantine/core';
import {
  IconActivityHeartbeat,
  IconArrowsExchange,
  IconBuildingHospital,
  IconCalendarEvent,
  IconHistory,
  IconNotes,
  IconPill,
  IconSearch,
  IconSearchOff,
  IconSettings,
  IconShieldLock,
  IconStethoscope,
  IconUser,
  IconUserCircle,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { useCan } from '../../auth/useCan';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import rows from '../../components/ListRows.module.css';
import { errorMessage } from '../../i18n/errors';
import { formatDate, formatTime, localDay } from '../../i18n/format';
import { useAudit, useCentreUsers, type AuditRow } from './api';

/** An icon per area of the app, from the action's first part ("session.open" -> session). */
const AREA_ICONS: Record<string, Icon> = {
  session: IconActivityHeartbeat,
  usage: IconPill,
  vitals: IconActivityHeartbeat,
  note: IconNotes,
  patient_note: IconNotes,
  order: IconStethoscope,
  patient: IconUser,
  plan: IconCalendarEvent,
  booking: IconCalendarEvent,
  roster: IconCalendarEvent,
  schedule: IconCalendarEvent,
  chair: IconCalendarEvent,
  transfer: IconArrowsExchange,
  user: IconUsers,
  manager: IconUsers,
  role: IconShieldLock,
  settings: IconSettings,
  centre: IconBuildingHospital,
  item: IconPill,
  unit: IconPill,
};

/** "session.open" -> "Session started"; unknown actions show as they are. */
export const actionLabel = (t: TFunction, action: string): string => t(`centre.audit.actions.${action}`, { defaultValue: action });

/** Rows whose action (raw or translated) or user name contains the search text. */
export function filterAudit(t: TFunction, list: AuditRow[], search: string): AuditRow[] {
  const q = search.trim().toLocaleLowerCase();
  if (!q) return list;
  return list.filter((r) => [r.action, actionLabel(t, r.action), r.user.name].some((f) => f.toLocaleLowerCase().includes(q)));
}

export function AuditPage() {
  const { t, i18n } = useTranslation();
  const [userId, setUserId] = useState('');
  const [search, setSearch] = useState('');
  const canListUsers = useCan('users.create') || useCan('users.edit');
  const users = useCentreUsers(canListUsers);
  const audit = useAudit(userId);

  const shown = filterAudit(t, audit.data ?? [], search);
  // newest first, as the server sends them; a heading whenever the day changes
  const days: { day: string; rows: AuditRow[] }[] = [];
  for (const r of shown) {
    const day = localDay(r.at);
    if (days.at(-1)?.day === day) days.at(-1)!.rows.push(r);
    else days.push({ day, rows: [r] });
  }

  return (
    <Stack gap="md">
      <PageHeader title={t('centre.audit.title')} subtitle={t('centre.audit.subtitle')} />
      <SimpleGrid cols={{ base: 1, sm: canListUsers ? 2 : 1 }} spacing="sm">
        <TextInput
          aria-label={t('centre.audit.search')}
          placeholder={t('centre.audit.search')}
          type="search"
          size="md"
          leftSection={<IconSearch size={18} aria-hidden />}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
        {canListUsers && (
          <Select
            aria-label={t('centre.audit.user')}
            placeholder={t('centre.audit.allUsers')}
            size="md"
            leftSection={<IconUserCircle size={18} aria-hidden />}
            data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
            value={userId || null}
            onChange={(v) => setUserId(v ?? '')}
            clearable
          />
        )}
      </SimpleGrid>
      {audit.isPending && <Loader />}
      {audit.isError && <Alert color="danger">{errorMessage(t, audit.error)}</Alert>}
      {audit.data?.length === 0 && <EmptyState icon={IconHistory} title={t('centre.audit.empty')} hint={t('centre.audit.emptyHint')} />}
      {!!audit.data?.length && shown.length === 0 && (
        <EmptyState icon={IconSearchOff} title={t('centre.audit.noMatch')} hint={t('centre.audit.noMatchHint')} />
      )}
      {days.length > 0 && (
        <Card padding={0}>
          {days.map(({ day, rows: list }) => (
            <Fragment key={day}>
              <Text size="sm" fw={700} c="uoca.8" className={rows.dayHeading}>
                {formatDate(day, i18n.language)}
              </Text>
              {list.map((r, i) => {
                const AreaIcon = AREA_ICONS[r.action.split('.')[0] ?? ''] ?? IconHistory;
                return (
                  <div key={`${r.at}-${i}`} className={rows.row} data-audit-row>
                    <ThemeIcon variant="light" color="uoca" size={38} radius="xl" aria-hidden>
                      <AreaIcon size={20} stroke={1.7} />
                    </ThemeIcon>
                    <Stack gap={0} className={rows.main}>
                      <Text fw={600} lineClamp={2}>
                        {actionLabel(t, r.action)}
                      </Text>
                      <Text size="sm" c="dimmed" truncate>
                        {r.user.name}
                      </Text>
                    </Stack>
                    <Group gap={4} wrap="nowrap">
                      <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                        <bdi dir="ltr">{formatTime(r.at, i18n.language)}</bdi>
                      </Text>
                    </Group>
                  </div>
                );
              })}
            </Fragment>
          ))}
        </Card>
      )}
    </Stack>
  );
}
