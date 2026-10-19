import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, Card, Group, Loader, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { PageHeader } from '../../components/PageHeader';
import { IconUserPlus, IconUserSearch } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { useDebouncedValue } from '@mantine/hooks';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { formatDay } from '../../components/timelineApi';
import { useCentreId } from '../centre/api';
import { usePatients, type StatusFilter } from './api';
import { PatientForm } from './PatientForm';

const FILTERS: StatusFilter[] = ['default', 'active', 'transferring', 'discharged', 'all'];

export function PatientsPage() {
  const { t, i18n } = useTranslation();
  const centreId = useCentreId();
  const canCreate = useCan('patients.create');
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 250);
  const [status, setStatus] = useState<StatusFilter>('default');
  const [creating, setCreating] = useState(false);
  const patients = usePatients(q, status);

  return (
    <Stack gap="md">
      <PageHeader
        title={t('desk.patients.title')}
        action={
          canCreate && (
            <Button mih={44} onClick={() => setCreating(true)} leftSection={<IconUserPlus size={18} aria-hidden />}>
              {t('desk.patients.new')}
            </Button>
          )
        }
      />
      <TextInput
        aria-label={t('desk.patients.search')}
        placeholder={t('desk.patients.search')}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <Select
        label={t('desk.patients.statusFilter')}
        allowDeselect={false}
        value={status}
        onChange={(v) => setStatus((v as StatusFilter | null) ?? 'default')}
        data={FILTERS.map((f) => ({ value: f, label: t(`desk.patients.filter.${f}`) }))}
      />
      {patients.isPending && <Loader />}
      {patients.isError && <Alert color="danger">{errorMessage(t, patients.error)}</Alert>}
      {patients.data?.length === 0 && (
        <EmptyState
          icon={IconUserSearch}
          title={t('desk.patients.empty')}
          hint={t('empty.patientsHint')}
          action={canCreate ? { label: t('desk.patients.new'), onClick: () => setCreating(true), icon: IconUserPlus } : undefined}
        />
      )}
      {patients.data?.map((p) => (
        <Card key={p.id} withBorder padding="sm" component={Link} to={`/c/${centreId}/patients/${p.id}`} mih={44}>
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={0}>
              <Text fw={600}>{p.name}</Text>
              {p.status !== 'discharged' && (
                <Text size="sm">
                  {p.nextSession
                    ? t('desk.patients.next', { day: formatDay(p.nextSession.date, i18n.language), time: p.nextSession.start })
                    : t('desk.patients.noNext')}
                </Text>
              )}
              {p.phone && (
                <Text size="sm" c="dimmed">
                  {p.phone}
                </Text>
              )}
            </Stack>
            {p.status !== 'active' && (
              <Badge variant="light" color={p.status === 'transferring' ? 'warning' : 'neutral'}>
                {t(`desk.patients.status.${p.status}`)}
              </Badge>
            )}
          </Group>
        </Card>
      ))}
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('desk.patients.new')} fullScreen>
        {creating && <PatientForm patient={null} onDone={() => setCreating(false)} />}
      </Modal>
    </Stack>
  );
}
