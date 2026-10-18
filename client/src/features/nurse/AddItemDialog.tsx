import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Group, Select, SegmentedControl, Stack, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import type { ItemDto, ItemType } from '../pm/api';
import { useAddItem, useAddUnit, useCatalogUnits } from './api';

/** Propose a missing catalogue item. Mount with a `key` so each open starts fresh. */
export function AddItemDialog({ onCreated }: { onCreated: (item: ItemDto) => void }) {
  const { t } = useTranslation();
  const units = useCatalogUnits();
  const addItem = useAddItem();
  const addUnit = useAddUnit();
  const [name, setName] = useState('');
  const [type, setType] = useState<ItemType>('medicine');
  const [unitId, setUnitId] = useState<string | null>(null);
  const [newUnit, setNewUnit] = useState('');
  const valid = name.trim() !== '' && !!unitId;

  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!valid) return;
        addItem.mutate(
          { name: name.trim(), type, unitId },
          {
            onSuccess: (item) => {
              notifications.show({ message: t('nurse.addItem.done') });
              onCreated(item);
            },
          },
        );
      }}
    >
      <TextInput label={t('nurse.addItem.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <SegmentedControl
        fullWidth
        value={type}
        onChange={(v) => setType(v as ItemType)}
        data={[
          { value: 'medicine', label: t('nurse.type.medicine') },
          { value: 'supply', label: t('nurse.type.supply') },
        ]}
      />
      <Select
        label={t('nurse.addItem.unit')}
        value={unitId}
        onChange={setUnitId}
        data={(units.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
      />
      <Group align="flex-end" wrap="nowrap">
        <TextInput style={{ flex: 1 }} label={t('nurse.addItem.newUnit')} value={newUnit} onChange={(e) => setNewUnit(e.currentTarget.value)} />
        <Button
          mih={44}
          variant="default"
          loading={addUnit.isPending}
          disabled={newUnit.trim() === ''}
          onClick={() =>
            addUnit.mutate(newUnit.trim(), {
              onSuccess: (u) => {
                setUnitId(u.id);
                setNewUnit('');
              },
            })
          }
        >
          {t('nurse.addItem.addUnit')}
        </Button>
      </Group>
      {addUnit.isError && <Alert color="danger">{errorMessage(t, addUnit.error)}</Alert>}
      {addItem.isError && <Alert color="danger">{errorMessage(t, addItem.error)}</Alert>}
      <Button type="submit" mih={44} loading={addItem.isPending} disabled={!valid}>
        {t('nurse.addItem.submit')}
      </Button>
    </Stack>
  );
}
