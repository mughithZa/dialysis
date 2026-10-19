import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionIcon, Alert, Button, Divider, Group, Menu, Modal, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconDots, IconPackage, IconPencil, IconPill, IconPlus, IconTrash } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { EmptyState } from '../../components/EmptyState';
import { errorMessage } from '../../i18n/errors';
import type { ItemDto } from '../pm/api';
import { quickItems, useCatalogItems, useRemoveUsage, useUpdateUsage, type SessionDetail, type UsageLineDto } from './api';
import { AmountForm, UsagePicker } from './UsagePicker';
import { timeOf } from './VitalsForm';

/** One recorded medicine or supply: name and amount, with Change/Remove in a ⋯ menu. */
export function UsageRow({ sessionId, line, canEdit }: { sessionId: string; line: UsageLineDto; canEdit: boolean }) {
  const { t } = useTranslation();
  const update = useUpdateUsage(sessionId);
  const remove = useRemoveUsage(sessionId);
  const [editing, setEditing] = useState(false);
  const TypeIcon = line.item.type === 'supply' ? IconPackage : IconPill;
  return (
    <Stack gap={4} data-usage-line>
      <Group gap="sm" wrap="nowrap" mih={52}>
        <ThemeIcon variant="light" color="uoca" size={36} radius="md" aria-hidden>
          <TypeIcon size={20} stroke={1.7} />
        </ThemeIcon>
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          <Text fw={600} truncate>
            {line.item.name}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {timeOf(line.at)} · {line.by.name}
          </Text>
        </Stack>
        <Text fw={700} c="uoca.8" dir="auto" style={{ whiteSpace: 'nowrap', unicodeBidi: 'isolate' }} data-usage-amount>
          {line.amount} {line.item.unit}
        </Text>
        {canEdit && (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="uoca" size={44} aria-label={t('nurse.usage.menu', { item: line.item.name })} loading={remove.isPending}>
                <IconDots size={20} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconPencil size={16} />} mih={44} onClick={() => setEditing(true)}>
                {t('nurse.usage.edit')}
              </Menu.Item>
              <Menu.Item
                color="danger"
                mih={44}
                leftSection={<IconTrash size={16} />}
                onClick={() => remove.mutate(line.id, { onSuccess: () => notifications.show({ message: t('nurse.usage.removed') }) })}
              >
                {t('nurse.usage.remove')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>
      {remove.isError && <Alert color="danger">{errorMessage(t, remove.error)}</Alert>}
      <Modal opened={editing} onClose={() => setEditing(false)} title={line.item.name}>
        {editing && (
          <AmountForm
            itemName={line.item.name}
            unit={line.item.unit}
            initial={String(line.amount)}
            loading={update.isPending}
            error={update.error}
            onSubmit={(amount) =>
              update.mutate(
                { lineId: line.id, amount },
                {
                  onSuccess: () => {
                    notifications.show({ message: t('nurse.usage.updated') });
                    setEditing(false);
                  },
                },
              )
            }
          />
        )}
      </Modal>
    </Stack>
  );
}

/** Quick-add buttons (Heparin first, then items used in this session) shown right on the page. */
function QuickAdd({ usage, onPick }: { usage: UsageLineDto[]; onPick: (item: ItemDto) => void }) {
  const { t } = useTranslation();
  const items = useCatalogItems();
  const quick = quickItems(items.data ?? [], usage);
  if (quick.length === 0) return null;
  return (
    <Stack gap={4}>
      <Text size="sm" c="dimmed">
        {t('nurse.usage.quickAdd')}
      </Text>
      <Group gap="xs" role="group" aria-label={t('nurse.usage.quickAdd')}>
        {quick.map((i) => (
          <Button
            key={i.id}
            variant="light"
            radius="xl"
            mih={44}
            leftSection={<IconPlus size={16} />}
            aria-label={t('nurse.usage.quickAddItem', { item: i.name })}
            onClick={() => onPick(i)}
          >
            {i.name}
          </Button>
        ))}
      </Group>
    </Stack>
  );
}

/** The medicines and supplies of a session: rows, quick-add chips and the big Add button. */
export function UsageList({ session, canEdit }: { session: SessionDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  // null: closed; {item: null}: the full picker; {item}: straight to the amount for that item
  const [adding, setAdding] = useState<{ item: ItemDto | null } | null>(null);
  return (
    <Stack gap="sm">
      {session.usage.length === 0 && <EmptyState compact icon={IconPill} title={t('nurse.usage.none')} hint={canEdit ? t('empty.usageHint') : undefined} />}
      {session.usage.length > 0 && (
        <Stack gap={0}>
          {session.usage.map((l, i) => (
            <Fragment key={l.id}>
              {i > 0 && <Divider color="var(--uoca-border)" />}
              <UsageRow sessionId={session.id} line={l} canEdit={canEdit} />
            </Fragment>
          ))}
        </Stack>
      )}
      {canEdit && (
        <>
          <QuickAdd usage={session.usage} onPick={(item) => setAdding({ item })} />
          <Button size="lg" mih={56} leftSection={<IconPlus size={20} />} onClick={() => setAdding({ item: null })}>
            {t('nurse.usage.add')}
          </Button>
        </>
      )}
      <Modal opened={adding !== null} onClose={() => setAdding(null)} title={t('nurse.usage.add')} fullScreen={adding?.item == null}>
        {adding && <UsagePicker sessionId={session.id} usage={session.usage} initial={adding.item} onDone={() => setAdding(null)} />}
      </Modal>
    </Stack>
  );
}
