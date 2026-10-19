import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Group, Loader, Modal, Select, Stack, Switch, Tabs, Text, TextInput, Title } from '@mantine/core';
import { errorMessage } from '../../i18n/errors';
import { useAddUnit, useItems, useUnits, useUpdateItem, type ItemDto, type ItemType } from './api';
import { MergeDialog } from './MergeDialog';

function EditItemDialog({ item, units, onClose }: { item: ItemDto | null; units: { id: string; name: string }[]; onClose: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateItem();
  const [name, setName] = useState(item?.name ?? '');
  const [unitId, setUnitId] = useState(item?.unitId ?? '');

  return (
    <Modal opened={item !== null} onClose={onClose} title={t('pm.catalog.editTitle')}>
      {item && (
        <Stack
          gap="sm"
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            update.mutate(
              { id: item.id, name: name.trim(), ...(unitId !== item.unitId ? { unitId } : {}) },
              { onSuccess: onClose },
            );
          }}
        >
          <TextInput label={t('pm.catalog.itemName')} value={name} onChange={(e) => setName(e.currentTarget.value)} required />
          <Select
            label={t('common.unit')}
            data={units.map((u) => ({ value: u.id, label: u.name }))}
            value={unitId}
            onChange={(v) => v && setUnitId(v)}
            disabled={item.used}
            description={item.used ? t('pm.catalog.unitLocked') : undefined}
            allowDeselect={false}
          />
          {update.isError && <Alert color="danger">{errorMessage(t, update.error)}</Alert>}
          <Button type="submit" mih={44} loading={update.isPending} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </Stack>
      )}
    </Modal>
  );
}

function UnitsPanel({ units }: { units: { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const add = useAddUnit();
  const [name, setName] = useState('');
  return (
    <Stack
      gap="xs"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        add.mutate(name.trim(), { onSuccess: () => setName('') });
      }}
    >
      <Text fw={600}>{t('pm.catalog.units')}</Text>
      <Group gap="xs">
        {units.map((u) => (
          <Badge key={u.id} variant="light" size="lg">
            {u.name}
          </Badge>
        ))}
      </Group>
      <Group align="flex-end" wrap="nowrap">
        <TextInput label={t('pm.catalog.newUnit')} value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
        <Button type="submit" mih={44} loading={add.isPending} disabled={!name.trim()}>
          {t('pm.catalog.addUnit')}
        </Button>
      </Group>
      {add.isError && <Alert color="danger">{errorMessage(t, add.error)}</Alert>}
    </Stack>
  );
}

export function CatalogPage() {
  const { t } = useTranslation();
  const items = useItems();
  const units = useUnits();
  const update = useUpdateItem();
  const [tab, setTab] = useState<ItemType>('medicine');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [merging, setMerging] = useState<ItemDto | null>(null);
  const [editing, setEditing] = useState<ItemDto | null>(null);

  const all = items.data ?? [];
  const unitName = (id: string) => units.data?.find((u) => u.id === id)?.name ?? '';
  const ofTab = all.filter((i) => i.type === tab && i.status !== 'retired');
  const pendingCount = ofTab.filter((i) => i.status === 'pending').length;
  const shown = pendingOnly ? ofTab.filter((i) => i.status === 'pending') : ofTab;

  return (
    <Stack gap="md">
      <Title order={2}>{t('pm.catalog.title')}</Title>
      <Tabs value={tab} onChange={(v) => v && setTab(v as ItemType)}>
        <Tabs.List grow>
          <Tabs.Tab value="medicine" mih={44}>
            {t('pm.catalog.medicines')}
          </Tabs.Tab>
          <Tabs.Tab value="supply" mih={44}>
            {t('pm.catalog.supplies')}
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <Group justify="space-between">
        <Switch size="md" label={t('pm.catalog.pendingOnly')} checked={pendingOnly} onChange={(e) => setPendingOnly(e.currentTarget.checked)} />
        <Badge color="warning" variant="light" size="lg" aria-label={t('pm.catalog.pendingBadge', { count: pendingCount })}>
          {pendingCount}
        </Badge>
      </Group>
      {items.isPending && <Loader />}
      {items.isError && <Alert color="danger">{errorMessage(t, items.error)}</Alert>}
      {update.isError && <Alert color="danger">{errorMessage(t, update.error)}</Alert>}
      {items.data && shown.length === 0 && <Text c="dimmed">{t('pm.catalog.empty')}</Text>}
      {shown.map((i) => (
        <Card key={i.id} withBorder padding="sm" data-item={i.id}>
          <Stack gap="xs">
            <Group justify="space-between" wrap="nowrap">
              <Stack gap={0}>
                <Text fw={600}>{i.name}</Text>
                <Text size="sm" c="dimmed">
                  {unitName(i.unitId)}
                </Text>
              </Stack>
              <Badge color={i.status === 'pending' ? 'warning' : 'neutral'} variant="light">
                {i.status === 'pending' ? t('pm.catalog.pending') : t('pm.catalog.approved')}
              </Badge>
            </Group>
            <Group>
              {i.status === 'pending' && (
                <Button
                  mih={44}
                  loading={update.isPending && update.variables?.id === i.id}
                  onClick={() => update.mutate({ id: i.id, status: 'approved' })}
                >
                  {t('pm.catalog.approve')}
                </Button>
              )}
              <Button mih={44} variant="default" onClick={() => setEditing(i)}>
                {t('common.edit')}
              </Button>
              <Button mih={44} variant="default" onClick={() => setMerging(i)}>
                {t('pm.catalog.merge')}
              </Button>
            </Group>
          </Stack>
        </Card>
      ))}
      <UnitsPanel units={units.data ?? []} />
      <MergeDialog key={`merge-${merging?.id ?? 'none'}`} item={merging} items={all} onClose={() => setMerging(null)} />
      <EditItemDialog key={`edit-${editing?.id ?? 'none'}`} item={editing} units={units.data ?? []} onClose={() => setEditing(null)} />
    </Stack>
  );
}
