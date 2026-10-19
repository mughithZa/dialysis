import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Chip, Group, Loader, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import type { ItemDto } from '../pm/api';
import { AddItemDialog } from './AddItemDialog';
import { quickItems, useAddUsage, useCatalogItems, useCatalogUnits, type UsageLineDto } from './api';

export const parseAmount = (s: string) => Number(s.trim().replace(',', '.'));

/** Amount entry with a numeric keypad and the unit as suffix. Mount with a `key` per item/line. */
export function AmountForm({
  itemName,
  unit,
  initial = '',
  loading,
  error,
  onSubmit,
}: {
  itemName: string;
  unit: string;
  initial?: string;
  loading: boolean;
  error: unknown;
  onSubmit: (amount: number) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial);
  const amount = parseAmount(text);
  const valid = Number.isFinite(amount) && amount > 0;
  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (valid) onSubmit(amount);
      }}
    >
      <Text fw={600}>{itemName}</Text>
      <TextInput
        label={t('nurse.usage.amount')}
        inputMode="decimal"
        size="lg"
        data-autofocus
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        rightSection={<Text size="sm">{unit}</Text>}
        rightSectionWidth={64}
      />
      {error != null && <Alert color="danger">{errorMessage(t, error)}</Alert>}
      <Button type="submit" size="lg" mih={44} loading={loading} disabled={!valid}>
        {t('nurse.usage.save')}
      </Button>
    </Stack>
  );
}

/** Pick a medicine or supply and record an amount. Mount with a `key` so each open starts fresh. */
export function UsagePicker({ sessionId, usage, onDone }: { sessionId: string; usage: UsageLineDto[]; onDone: () => void }) {
  const { t } = useTranslation();
  const items = useCatalogItems();
  const units = useCatalogUnits();
  const add = useAddUsage(sessionId);
  const [mode, setMode] = useState<'pick' | 'add'>('pick');
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<ItemDto | null>(null);

  if (chosen) {
    return (
      <AmountForm
        itemName={chosen.name}
        unit={units.data?.find((u) => u.id === chosen.unitId)?.name ?? ''}
        loading={add.isPending}
        error={add.error}
        onSubmit={(amount) =>
          add.mutate(
            { itemId: chosen.id, amount },
            {
              onSuccess: () => {
                notifications.show({ message: t('nurse.usage.added') });
                onDone();
              },
            },
          )
        }
      />
    );
  }
  if (mode === 'add') {
    return (
      <AddItemDialog
        onCreated={(item) => {
          setQ(item.name);
          setType('all');
          setMode('pick');
        }}
      />
    );
  }

  const all = items.data ?? [];
  const needle = q.trim().toLowerCase();
  const shown = all.filter((i) => (type === 'all' || i.type === type) && i.name.toLowerCase().includes(needle));
  const quick = quickItems(all, usage);
  return (
    <Stack gap="sm">
      {items.isPending && <Loader size="sm" />}
      {items.isError && <Alert color="danger">{errorMessage(t, items.error)}</Alert>}
      {quick.length > 0 && (
        <Stack gap={4}>
          <Text size="sm" c="dimmed">
            {t('nurse.usage.quick')}
          </Text>
          <Group gap="xs" role="group" aria-label={t('nurse.usage.quick')}>
            {quick.map((i) => (
              <Chip key={i.id} checked={false} onChange={() => setChosen(i)}>
                {i.name}
              </Chip>
            ))}
          </Group>
        </Stack>
      )}
      <TextInput type="search" label={t('nurse.usage.search')} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      <SegmentedControl
        fullWidth
        value={type}
        onChange={setType}
        data={[
          { value: 'all', label: t('nurse.type.all') },
          { value: 'medicine', label: t('nurse.type.medicine') },
          { value: 'supply', label: t('nurse.type.supply') },
        ]}
      />
      {items.data && shown.length === 0 && <EmptyState compact icon={IconSearch} title={t('nurse.usage.noMatch')} />}
      {shown.map((i) => (
        <Button key={i.id} variant="default" mih={44} fullWidth onClick={() => setChosen(i)}>
          {i.name}
          {i.status === 'pending' && (
            <Badge ms="xs" variant="light" color="warning">
              {t('nurse.usage.pending')}
            </Badge>
          )}
        </Button>
      ))}
      <Button variant="subtle" mih={44} onClick={() => setMode('add')}>
        {t('nurse.usage.addMissing')}
      </Button>
    </Stack>
  );
}
