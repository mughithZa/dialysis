import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Chip, Group, Loader, Modal, Select, Stack, Tabs, Text, TextInput, ThemeIcon } from '@mantine/core';
import {
  IconArrowMerge,
  IconCheck,
  IconPackage,
  IconPencil,
  IconPill,
  IconPlus,
  IconRuler2,
  IconSearch,
  IconSearchOff,
} from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
import { RowMenu } from '../../components/RowMenu';
import { StateChip } from '../../components/StateChip';
import rows from '../../components/ListRows.module.css';
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
    <SectionCard icon={IconRuler2} title={t('pm.catalog.units')} hint={t('pm.catalog.unitsHint')}>
      <Group gap="xs">
        {units.map((u) => (
          <StateChip key={u.id} tone="info" size="lg">
            {u.name}
          </StateChip>
        ))}
      </Group>
      <Stack
        gap="xs"
        component="form"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          add.mutate(name.trim(), { onSuccess: () => setName('') });
        }}
      >
        <Group align="flex-end" wrap="nowrap">
          <TextInput label={t('pm.catalog.newUnit')} value={name} onChange={(e) => setName(e.currentTarget.value)} style={{ flex: 1 }} />
          <Button type="submit" mih={44} loading={add.isPending} disabled={!name.trim()} leftSection={<IconPlus size={16} aria-hidden />}>
            {t('pm.catalog.addUnit')}
          </Button>
        </Group>
        {add.isError && <Alert color="danger">{errorMessage(t, add.error)}</Alert>}
      </Stack>
    </SectionCard>
  );
}

/** Items of one type matching the search (name, case-insensitive) and the pending filter; retired items never show. */
export function filterItems(all: ItemDto[], type: ItemType, search: string, pendingOnly: boolean): ItemDto[] {
  const q = search.trim().toLocaleLowerCase();
  return all.filter(
    (i) =>
      i.type === type &&
      i.status !== 'retired' &&
      (!pendingOnly || i.status === 'pending') &&
      (!q || i.name.toLocaleLowerCase().includes(q)),
  );
}

export function CatalogPage() {
  const { t } = useTranslation();
  const items = useItems();
  const units = useUnits();
  const update = useUpdateItem();
  const [tab, setTab] = useState<ItemType>('medicine');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [merging, setMerging] = useState<ItemDto | null>(null);
  const [editing, setEditing] = useState<ItemDto | null>(null);

  const all = items.data ?? [];
  const unitName = (id: string) => units.data?.find((u) => u.id === id)?.name ?? '';
  const live = (type: ItemType) => all.filter((i) => i.type === type && i.status !== 'retired');
  const pendingCount = live(tab).filter((i) => i.status === 'pending').length;
  const shown = filterItems(all, tab, search, pendingOnly);
  const approve = (i: ItemDto) => update.mutate({ id: i.id, status: 'approved' });
  const TypeIcon = tab === 'medicine' ? IconPill : IconPackage;

  return (
    <Stack gap="md">
      <PageHeader
        title={t('pm.catalog.title')}
        subtitle={items.data ? t('pm.catalog.subtitle', { medicines: live('medicine').length, supplies: live('supply').length }) : undefined}
      />
      <Tabs value={tab} onChange={(v) => v && setTab(v as ItemType)}>
        <Tabs.List grow>
          <Tabs.Tab value="medicine" mih={44} leftSection={<IconPill size={16} aria-hidden />}>
            {t('pm.catalog.medicines')}
          </Tabs.Tab>
          <Tabs.Tab value="supply" mih={44} leftSection={<IconPackage size={16} aria-hidden />}>
            {t('pm.catalog.supplies')}
          </Tabs.Tab>
        </Tabs.List>
      </Tabs>
      <TextInput
        aria-label={t('pm.catalog.search')}
        placeholder={t('pm.catalog.search')}
        type="search"
        size="md"
        leftSection={<IconSearch size={18} aria-hidden />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <div role="radiogroup" aria-label={t('pm.catalog.filter')} className={rows.filters}>
        <Chip.Group value={pendingOnly ? 'pending' : 'all'} onChange={(v) => setPendingOnly(v === 'pending')}>
          <Chip value="all" size="sm" variant="light">
            {t('pm.catalog.all')}
          </Chip>
          <Chip value="pending" size="sm" variant="light" aria-label={t('pm.catalog.pendingBadge', { count: pendingCount })}>
            {t('pm.catalog.pendingOnly')} · {pendingCount}
          </Chip>
        </Chip.Group>
      </div>
      {items.isPending && <Loader />}
      {items.isError && <Alert color="danger">{errorMessage(t, items.error)}</Alert>}
      {update.isError && <Alert color="danger">{errorMessage(t, update.error)}</Alert>}
      {items.data && shown.length === 0 && (
        <EmptyState
          icon={search.trim() ? IconSearchOff : TypeIcon}
          title={search.trim() || pendingOnly ? t('pm.catalog.noMatch') : t('pm.catalog.empty')}
          hint={search.trim() || pendingOnly ? t('pm.catalog.noMatchHint') : t('empty.itemsHint')}
        />
      )}
      {shown.length > 0 && (
        <Card padding={0}>
          {shown.map((i) => (
            <div key={i.id} className={rows.row} data-item={i.id}>
              <ThemeIcon variant="light" color={i.status === 'pending' ? 'amber' : 'uoca'} size={42} radius="xl" aria-hidden>
                <TypeIcon size={22} stroke={1.7} />
              </ThemeIcon>
              <Stack gap={2} className={rows.main}>
                <Text fw={600} truncate>
                  {i.name}
                </Text>
                <Group gap={6} wrap="nowrap">
                  <Text size="sm" c="dimmed">
                    {unitName(i.unitId)}
                  </Text>
                  <StateChip tone={i.status === 'pending' ? 'waiting' : 'on'} size="sm">
                    {i.status === 'pending' ? t('pm.catalog.pending') : t('pm.catalog.approved')}
                  </StateChip>
                </Group>
              </Stack>
              {i.status === 'pending' && (
                <Button
                  mih={44}
                  variant="light"
                  color="success"
                  px="sm"
                  leftSection={<IconCheck size={16} aria-hidden />}
                  loading={update.isPending && update.variables?.id === i.id}
                  onClick={() => approve(i)}
                >
                  {t('pm.catalog.approve')}
                </Button>
              )}
              <RowMenu
                label={t('pm.catalog.menu', { name: i.name })}
                items={[
                  { label: t('common.edit'), icon: IconPencil, onClick: () => setEditing(i) },
                  { label: t('pm.catalog.merge'), icon: IconArrowMerge, onClick: () => setMerging(i) },
                ]}
              />
            </div>
          ))}
        </Card>
      )}
      <UnitsPanel units={units.data ?? []} />
      <MergeDialog key={`merge-${merging?.id ?? 'none'}`} item={merging} items={all} onClose={() => setMerging(null)} />
      <EditItemDialog key={`edit-${editing?.id ?? 'none'}`} item={editing} units={units.data ?? []} onClose={() => setEditing(null)} />
    </Stack>
  );
}
