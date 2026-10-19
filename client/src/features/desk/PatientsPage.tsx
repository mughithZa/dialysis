import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Alert, Button, Card, Chip, Group, Loader, Modal, Stack, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconCalendarEvent, IconPhone, IconSearch, IconUserPlus, IconUserSearch } from '@tabler/icons-react';
import { useDebouncedValue } from '@mantine/hooks';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { PersonAvatar } from '../../components/PersonAvatar';
import { PatientStatusBadge } from '../../components/StatusBadge';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { formatDay } from '../../components/timelineApi';
import { useCentreId } from '../centre/api';
import { usePatients, type PatientListItem, type StatusFilter } from './api';
import { PatientForm } from './PatientForm';
import classes from './PatientsPage.module.css';

const FILTERS: StatusFilter[] = ['default', 'active', 'transferring', 'discharged', 'all'];

function PatientRow({ p }: { p: PatientListItem }) {
  const { t, i18n } = useTranslation();
  const centreId = useCentreId();
  return (
    <UnstyledButton component={Link} to={`/c/${centreId}/patients/${p.id}`} className={classes.row} data-patient-row>
      <PersonAvatar name={p.name} size={42} />
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Text fw={600} truncate>
          {p.name}
        </Text>
        {p.status !== 'discharged' && (
          <Group gap={4} wrap="nowrap" c={p.nextSession ? undefined : 'dimmed'}>
            <IconCalendarEvent size={14} aria-hidden style={{ flexShrink: 0 }} />
            <Text size="sm" truncate>
              {p.nextSession
                ? t('desk.patients.next', { day: formatDay(p.nextSession.date, i18n.language), time: p.nextSession.start })
                : t('desk.patients.noNext')}
            </Text>
          </Group>
        )}
        {p.phone && (
          <Group gap={4} wrap="nowrap" c="dimmed">
            <IconPhone size={14} aria-hidden style={{ flexShrink: 0 }} />
            <Text size="sm" span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
              {p.phone}
            </Text>
          </Group>
        )}
      </Stack>
      <PatientStatusBadge status={p.status} />
    </UnstyledButton>
  );
}

export function PatientsPage() {
  const { t } = useTranslation();
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
        subtitle={patients.data ? t('desk.patients.count', { count: patients.data.length }) : undefined}
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
        size="md"
        leftSection={<IconSearch size={18} aria-hidden />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      <div role="radiogroup" aria-label={t('desk.patients.statusFilter')} className={classes.filters}>
        <Chip.Group value={status} onChange={(v) => setStatus(v as StatusFilter)}>
          {FILTERS.map((f) => (
            <Chip key={f} value={f} size="sm" variant="light">
              {t(`desk.patients.filter.${f}`)}
            </Chip>
          ))}
        </Chip.Group>
      </div>
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
      {!!patients.data?.length && (
        <Card padding={0}>
          {patients.data.map((p) => (
            <PatientRow key={p.id} p={p} />
          ))}
        </Card>
      )}
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('desk.patients.new')} fullScreen>
        {creating && <PatientForm patient={null} onDone={() => setCreating(false)} />}
      </Modal>
    </Stack>
  );
}
