import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Modal, Radio, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useMergeItem, type ItemDto } from './api';

/** Candidates: same type and unit, not the item itself, not retired. */
export const mergeCandidates = (item: ItemDto, all: ItemDto[]) =>
  all.filter((o) => o.id !== item.id && o.type === item.type && o.unitId === item.unitId && o.status !== 'retired');

interface Props {
  item: ItemDto | null;
  items: ItemDto[];
  onClose: () => void;
}

export function MergeDialog({ item, items, onClose }: Props) {
  const { t } = useTranslation();
  const merge = useMergeItem();
  const [intoId, setIntoId] = useState('');
  const candidates = item ? mergeCandidates(item, items) : [];

  return (
    <Modal opened={item !== null} onClose={onClose} title={t('pm.catalog.mergeTitle', { name: item?.name ?? '' })}>
      {item && (
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {t('pm.catalog.mergeHint')}
          </Text>
          {candidates.length === 0 ? (
            <Text>{t('pm.catalog.mergeNone')}</Text>
          ) : (
            <Radio.Group value={intoId} onChange={setIntoId} label={t('pm.catalog.mergeInto')}>
              <Stack gap="xs" mt="xs">
                {candidates.map((c) => (
                  <Radio key={c.id} value={c.id} label={c.name} size="md" />
                ))}
              </Stack>
            </Radio.Group>
          )}
          {merge.isError && <Alert color="danger">{errorMessage(t, merge.error)}</Alert>}
          <Button
            mih={44}
            disabled={!intoId}
            loading={merge.isPending}
            onClick={() =>
              merge.mutate(
                { id: item.id, intoId },
                {
                  onSuccess: () => {
                    notifications.show({ message: t('pm.catalog.merged') });
                    onClose();
                  },
                },
              )
            }
          >
            {t('pm.catalog.merge')}
          </Button>
        </Stack>
      )}
    </Modal>
  );
}
