import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Accordion, Alert, Badge, Button, Checkbox, Group, Loader, Stack, Text, TextInput } from '@mantine/core';
import { CATEGORIES, GLOBAL_PERMISSIONS, type Permission } from '@dialysis/shared';
import { errorMessage } from '../../i18n/errors';
import { usePermissions, useSaveRole, type RoleDto } from './api';

interface Props {
  /** null creates a new centre role. */
  role: RoleDto | null;
  onDone: () => void;
}

/**
 * A role's name and permissions. Permissions sit in one collapsible card per category with "n of m" on the header;
 * categories that already have a permission start open.
 */
export function RoleEditor({ role, onDone }: Props) {
  const { t } = useTranslation();
  const perms = usePermissions();
  const save = useSaveRole();
  const [name, setName] = useState(role?.name ?? '');
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);
  const [open, setOpen] = useState<string[] | null>(null);

  const locked = role?.key === 'program_manager' || role?.scope === 'global';
  const isGlobalRole = role?.scope === 'global';
  // Global permissions only make sense on global roles; hide them for centre roles.
  const visible = (perms.data ?? []).filter((p) => isGlobalRole || !GLOBAL_PERMISSIONS.includes(p.key as Permission));

  const toggle = (key: string, on: boolean) => setSelected((cur) => (on ? [...cur, key] : cur.filter((k) => k !== key)));
  const setMany = (keys: string[], on: boolean) =>
    setSelected((cur) => (on ? [...new Set([...cur, ...keys])] : cur.filter((k) => !keys.includes(k))));

  const submit = () => save.mutate({ id: role?.id ?? null, name: name.trim(), permissions: selected }, { onSuccess: onDone });

  if (perms.isPending) return <Loader />;
  if (perms.isError) return <Alert color="danger">{errorMessage(t, perms.error)}</Alert>;

  const groups = CATEGORIES.map((cat) => ({ cat, items: visible.filter((p) => p.category === cat) })).filter((g) => g.items.length);
  const count = selected.filter((k) => visible.some((p) => p.key === k)).length;
  const opened = open ?? groups.filter((g) => g.items.some((p) => selected.includes(p.key))).map((g) => g.cat);

  return (
    <Stack gap="md">
      <TextInput label={t('pm.roles.roleName')} value={name} onChange={(e) => setName(e.currentTarget.value)} disabled={locked} required />
      <Group justify="space-between" wrap="nowrap">
        <Text fw={600}>{t('pm.roles.permissions')}</Text>
        <Text size="sm" c="dimmed" data-selected-count>
          {t('pm.roles.selected', { count, total: visible.length })}
        </Text>
      </Group>
      <Accordion multiple variant="separated" radius="lg" value={opened} onChange={setOpen} chevronPosition="right">
        {groups.map(({ cat, items }) => {
          const n = items.filter((p) => selected.includes(p.key)).length;
          const keys = items.map((p) => p.key);
          return (
            <Accordion.Item key={cat} value={cat} data-category={cat} style={{ borderColor: 'var(--uoca-border)', background: 'var(--uoca-surface)' }}>
              <Accordion.Control mih={52}>
                <Group justify="space-between" wrap="nowrap" pe="xs">
                  <Text fw={600}>{t(`category.${cat}`)}</Text>
                  <Badge
                    variant="light"
                    color={n === 0 ? 'grey' : 'uoca'}
                    aria-label={t('pm.roles.categoryCount', { count: n, total: items.length })}
                  >
                    <bdi dir="ltr">
                      {n}/{items.length}
                    </bdi>
                  </Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  {!locked && items.length > 1 && (
                    <Checkbox
                      size="md"
                      fw={600}
                      label={t('pm.roles.selectAll')}
                      checked={n === items.length}
                      indeterminate={n > 0 && n < items.length}
                      onChange={(e) => setMany(keys, e.currentTarget.checked)}
                      aria-label={t('pm.roles.selectAllIn', { category: t(`category.${cat}`) })}
                    />
                  )}
                  {items.map((p) => (
                    <Checkbox
                      key={p.key}
                      size="md"
                      label={t(`perm.${p.key}`)}
                      checked={selected.includes(p.key)}
                      disabled={locked}
                      onChange={(e) => toggle(p.key, e.currentTarget.checked)}
                    />
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
      {save.isError && <Alert color="danger">{errorMessage(t, save.error)}</Alert>}
      {!locked && (
        <Button mih={44} onClick={submit} loading={save.isPending} disabled={!name.trim()}>
          {t('common.save')}
        </Button>
      )}
    </Stack>
  );
}
