import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Group, Loader, Modal, Stack, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconLock, IconPlus, IconShieldLock, IconWorld } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { StateChip } from '../../components/StateChip';
import rows from '../../components/ListRows.module.css';
import { errorMessage } from '../../i18n/errors';
import { useRoles, type RoleDto } from './api';
import { roleLabel } from '../../i18n/roleLabel';
import { RoleEditor } from './RoleEditor';

export function RolesPage() {
  const { t, i18n } = useTranslation();
  const roles = useRoles();
  // `undefined` = closed, `null` = new role, otherwise editing that role.
  const [editing, setEditing] = useState<RoleDto | null | undefined>(undefined);
  const Chevron = i18n.dir() === 'rtl' ? IconChevronLeft : IconChevronRight;
  const list = roles.data ?? [];

  return (
    <Stack gap="md">
      <PageHeader
        title={t('pm.roles.title')}
        subtitle={roles.data ? t('pm.roles.count', { count: list.length }) : undefined}
        action={
          <Button mih={44} onClick={() => setEditing(null)} leftSection={<IconPlus size={18} aria-hidden />}>
            {t('pm.roles.new')}
          </Button>
        }
      />
      {roles.isPending && <Loader />}
      {roles.isError && <Alert color="danger">{errorMessage(t, roles.error)}</Alert>}
      {roles.data?.length === 0 && (
        <EmptyState
          icon={IconShieldLock}
          title={t('pm.roles.empty')}
          hint={t('empty.rolesHint')}
          action={{ label: t('pm.roles.new'), onClick: () => setEditing(null), icon: IconPlus }}
        />
      )}
      {list.length > 0 && (
        <Card padding={0}>
          {list.map((r) => {
            const locked = r.key === 'program_manager' || r.scope === 'global';
            return (
              <UnstyledButton
                key={r.id}
                className={rows.row}
                onClick={() => setEditing(r)}
                data-role={r.key}
                aria-label={t(locked ? 'pm.roles.viewRole' : 'pm.roles.editRole', { name: roleLabel(t, r) })}
              >
                <ThemeIcon variant="light" color={r.scope === 'global' ? 'slate' : 'uoca'} size={42} radius="xl" aria-hidden>
                  {r.scope === 'global' ? <IconWorld size={22} stroke={1.7} /> : <IconShieldLock size={22} stroke={1.7} />}
                </ThemeIcon>
                <Stack gap={4} className={rows.main}>
                  <Text fw={600} truncate>
                    {roleLabel(t, r)}
                  </Text>
                  <Group gap={6} wrap="wrap">
                    <StateChip tone="info">{r.scope === 'global' ? t('pm.roles.global') : t('pm.roles.centre')}</StateChip>
                    <Text size="sm" c="dimmed">
                      {t('pm.roles.permCount', { count: r.permissions.length })}
                    </Text>
                    {locked && <IconLock size={14} aria-hidden color="var(--uoca-muted)" />}
                  </Group>
                </Stack>
                <Chevron size={18} aria-hidden color="var(--uoca-muted)" />
              </UnstyledButton>
            );
          })}
        </Card>
      )}
      <Modal opened={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? roleLabel(t, editing) : t('pm.roles.new')} fullScreen>
        {editing !== undefined && (
          <Stack gap="md" maw={640} mx="auto">
            {editing?.key === 'program_manager' && (
              <Alert color="slate" icon={<IconLock size={18} />}>
                {t('pm.roles.locked')}
              </Alert>
            )}
            <RoleEditor role={editing} onDone={() => setEditing(undefined)} />
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
