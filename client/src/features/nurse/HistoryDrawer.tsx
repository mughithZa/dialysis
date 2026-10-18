import { useTranslation } from 'react-i18next';
import { Alert, Card, Drawer, Loader, Stack, Text } from '@mantine/core';
import { errorMessage } from '../../i18n/errors';
import { useHistory } from './api';

const show = (v: unknown) => (v === null || v === undefined ? '-' : JSON.stringify(v));

/** Audit trail of edits made after the session was closed. */
export function HistoryDrawer({ sessionId, opened, onClose }: { sessionId: string; opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const history = useHistory(sessionId, opened);
  return (
    <Drawer opened={opened} onClose={onClose} title={t('nurse.history.title')} position="bottom" size="85%">
      <Stack gap="sm">
        {history.isPending && <Loader size="sm" />}
        {history.isError && <Alert color="danger">{errorMessage(t, history.error)}</Alert>}
        {history.data?.length === 0 && <Text c="dimmed">{t('nurse.history.none')}</Text>}
        {history.data?.map((c) => (
          <Card key={c.id} withBorder padding="sm">
            <Text fw={600}>{t(`nurse.history.kind.${c.kind}`, { defaultValue: c.kind })}</Text>
            <Text size="xs" c="dimmed">
              {new Date(c.at).toLocaleString()} · {c.by.name}
            </Text>
            <Text size="sm">{t('nurse.history.before', { value: show(c.before) })}</Text>
            <Text size="sm">{t('nurse.history.after', { value: show(c.after) })}</Text>
          </Card>
        ))}
      </Stack>
    </Drawer>
  );
}
