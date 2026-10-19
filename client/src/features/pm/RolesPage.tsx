import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Group, Loader, Modal, Stack, Text, Title } from '@mantine/core';
import { errorMessage } from '../../i18n/errors';
import { useRoles, type RoleDto } from './api';
import { roleLabel } from '../../i18n/roleLabel';
import { RoleEditor } from './RoleEditor';

export function RolesPage() {
  const { t } = useTranslation();
  const roles = useRoles();
  // `undefined` = closed, `null` = new role, otherwise editing that role.
  const [editing, setEditing] = useState<RoleDto | null | undefined>(undefined);

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Title order={2}>{t('pm.roles.title')}</Title>
        <Button mih={44} onClick={() => setEditing(null)}>
          {t('pm.roles.new')}
        </Button>
      </Group>
      {roles.isPending && <Loader />}
      {roles.isError && <Alert color="danger">{errorMessage(t, roles.error)}</Alert>}
      {roles.data?.length === 0 && <Text c="dimmed">{t('pm.roles.empty')}</Text>}
      {roles.data?.map((r) => (
        <Card key={r.id} withBorder padding="sm">
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={4}>
              <Text fw={600}>{roleLabel(t, r)}</Text>
              <Badge variant="light" w="fit-content">
                {r.scope === 'global' ? t('pm.roles.global') : t('pm.roles.centre')}
              </Badge>
            </Stack>
            <Button mih={44} variant="default" onClick={() => setEditing(r)}>
              {r.key === 'program_manager' ? t('common.view') : t('common.edit')}
            </Button>
          </Group>
        </Card>
      ))}
      <Modal opened={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? roleLabel(t, editing) : t('pm.roles.new')} fullScreen>
        {editing !== undefined && (
          <Stack gap="md">
            {editing?.key === 'program_manager' && <Alert>{t('pm.roles.locked')}</Alert>}
            <RoleEditor role={editing} onDone={() => setEditing(undefined)} />
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
