import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Checkbox, Fieldset, Loader, Stack, TextInput } from '@mantine/core';
import { CATEGORIES, GLOBAL_PERMISSIONS, type Permission } from '@dialysis/shared';
import { errorMessage } from '../../i18n/errors';
import { usePermissions, useSaveRole, type RoleDto } from './api';

interface Props {
  /** null creates a new centre role. */
  role: RoleDto | null;
  onDone: () => void;
}

export function RoleEditor({ role, onDone }: Props) {
  const { t } = useTranslation();
  const perms = usePermissions();
  const save = useSaveRole();
  const [name, setName] = useState(role?.name ?? '');
  const [selected, setSelected] = useState<string[]>(role?.permissions ?? []);

  const locked = role?.key === 'program_manager' || role?.scope === 'global';
  const isGlobalRole = role?.scope === 'global';
  // Global permissions only make sense on global roles; hide them for centre roles.
  const visible = (perms.data ?? []).filter((p) => isGlobalRole || !GLOBAL_PERMISSIONS.includes(p.key as Permission));

  const toggle = (key: string, on: boolean) =>
    setSelected((cur) => (on ? [...cur, key] : cur.filter((k) => k !== key)));

  const submit = () => save.mutate({ id: role?.id ?? null, name: name.trim(), permissions: selected }, { onSuccess: onDone });

  if (perms.isPending) return <Loader />;
  if (perms.isError) return <Alert color="danger">{errorMessage(t, perms.error)}</Alert>;

  return (
    <Stack gap="md">
      <TextInput label={t('pm.roles.roleName')} value={name} onChange={(e) => setName(e.currentTarget.value)} disabled={locked} required />
      {CATEGORIES.map((cat) => {
        const items = visible.filter((p) => p.category === cat);
        if (!items.length) return null;
        return (
          <Fieldset key={cat} legend={t(`category.${cat}`)}>
            <Stack gap="xs">
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
          </Fieldset>
        );
      })}
      {save.isError && <Alert color="danger">{errorMessage(t, save.error)}</Alert>}
      {!locked && (
        <Button mih={44} onClick={submit} loading={save.isPending} disabled={!name.trim()}>
          {t('common.save')}
        </Button>
      )}
    </Stack>
  );
}
