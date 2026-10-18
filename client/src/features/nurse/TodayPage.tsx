import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Accordion, Alert, Badge, Card, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { errorMessage } from '../../i18n/errors';
import { useCentreId } from '../centre/api';
import { useToday, type SessionCard } from './api';

const STATUS_COLOR: Record<string, string> = { active: 'primary', completed: 'success', postponed: 'warning', missed: 'danger' };

function SessionCardLink({ s }: { s: SessionCard }) {
  const { t } = useTranslation();
  const centreId = useCentreId();
  return (
    <Card withBorder padding="sm" component={Link} to={`/c/${centreId}/sessions/${s.id}`} mih={44} style={{ textDecoration: 'none', color: 'inherit' }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2}>
          <Text fw={600}>{s.patient.name}</Text>
          <Text size="sm" c="dimmed">
            {t('nurse.today.chair', { chair: s.chair.label })} · {s.shift.name} ({s.shift.start}-{s.shift.end})
          </Text>
        </Stack>
        <Stack gap={4} align="flex-end">
          <Badge variant="light" color={STATUS_COLOR[s.status] ?? 'neutral'}>
            {t(`sessions.status.${s.status}`)}
          </Badge>
          {s.hasActiveOrders && (
            <Badge variant="filled" color="warning">
              {t('nurse.today.orders')}
            </Badge>
          )}
        </Stack>
      </Group>
    </Card>
  );
}

export function TodayPage() {
  const { t } = useTranslation();
  const today = useToday();
  const d = today.data;
  const sections = d
    ? ([
        ['mine', t('nurse.today.mine'), d.mine],
        ['unassigned', t('nurse.today.unassigned'), d.unassigned],
        ['others', t('nurse.today.others'), d.others],
      ] as const)
    : [];
  return (
    <Stack gap="md">
      <Title order={2}>{t('nav.today')}</Title>
      {today.isPending && <Loader size="sm" />}
      {today.isError && <Alert color="danger">{errorMessage(t, today.error)}</Alert>}
      {d && (
        <Accordion multiple defaultValue={['mine', 'unassigned']} variant="separated">
          {sections.map(([key, label, cards]) => (
            <Accordion.Item key={key} value={key}>
              <Accordion.Control mih={44}>
                {label} ({cards.length})
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  {cards.length === 0 && <Text c="dimmed">{t('nurse.today.none')}</Text>}
                  {cards.map((s) => (
                    <SessionCardLink key={s.id} s={s} />
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
    </Stack>
  );
}
