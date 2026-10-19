import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconHeartRateMonitor } from '@tabler/icons-react';
import { EmptyState } from '../../components/EmptyState';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useAddBp, useSaveWeights, type SessionDetail } from './api';
import { parseAmount } from './UsagePicker';
import { dateLocale } from '../../i18n';

export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });

const positive = (s: string) => {
  const n = parseAmount(s);
  return s.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Weights and blood-pressure readings. `canEdit` hides the inputs for read-only viewers. */
export function VitalsForm({ session, canEdit }: { session: SessionDetail; canEdit: boolean }) {
  const { t } = useTranslation();
  const saveWeights = useSaveWeights(session.id);
  const addBp = useAddBp(session.id);
  const [before, setBefore] = useState(session.vitals.weightBefore?.toString() ?? '');
  const [after, setAfter] = useState(session.vitals.weightAfter?.toString() ?? '');
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const body = { weightBefore: positive(before), weightAfter: positive(after) };
  const hasWeight = body.weightBefore !== undefined || body.weightAfter !== undefined;
  const systolic = positive(sys);
  const diastolic = positive(dia);

  return (
    <Stack gap="sm">
      <Title order={4}>{t('nurse.vitals.title')}</Title>
      {canEdit ? (
        <Stack gap="xs">
          <Group grow align="flex-end" wrap="nowrap">
            <TextInput label={t('nurse.vitals.weightBefore')} inputMode="decimal" rightSection={<Text size="xs">{t('nurse.vitals.kg')}</Text>} value={before} onChange={(e) => setBefore(e.currentTarget.value)} />
            <TextInput label={t('nurse.vitals.weightAfter')} inputMode="decimal" rightSection={<Text size="xs">{t('nurse.vitals.kg')}</Text>} value={after} onChange={(e) => setAfter(e.currentTarget.value)} />
          </Group>
          <Button
            mih={44}
            variant="default"
            disabled={!hasWeight}
            loading={saveWeights.isPending}
            onClick={() =>
              saveWeights.mutate(
                { ...(body.weightBefore !== undefined && { weightBefore: body.weightBefore }), ...(body.weightAfter !== undefined && { weightAfter: body.weightAfter }) },
                { onSuccess: () => notifications.show({ message: t('nurse.vitals.weightsSaved') }) },
              )
            }
          >
            {t('nurse.vitals.saveWeights')}
          </Button>
          {saveWeights.isError && <Alert color="danger">{errorMessage(t, saveWeights.error)}</Alert>}
        </Stack>
      ) : (
        <Text>
          {t('sessions.history.weightBefore', { kg: session.vitals.weightBefore ?? '-' })} · {t('sessions.history.weightAfter', { kg: session.vitals.weightAfter ?? '-' })}
        </Text>
      )}

      <Title order={5}>{t('nurse.vitals.bpTitle')}</Title>
      {session.vitals.bp.length === 0 && <EmptyState compact icon={IconHeartRateMonitor} title={t('nurse.vitals.noBp')} />}
      {session.vitals.bp.map((b) => (
        <Text key={b.at}>
          {timeOf(b.at)} · {t('sessions.history.bp', { systolic: b.systolic, diastolic: b.diastolic })}
        </Text>
      ))}
      {canEdit && (
        <Stack gap="xs">
          <Group grow wrap="nowrap">
            <TextInput label={t('nurse.vitals.systolic')} inputMode="numeric" value={sys} onChange={(e) => setSys(e.currentTarget.value)} />
            <TextInput label={t('nurse.vitals.diastolic')} inputMode="numeric" value={dia} onChange={(e) => setDia(e.currentTarget.value)} />
          </Group>
          <Button
            mih={44}
            disabled={systolic === undefined || diastolic === undefined}
            loading={addBp.isPending}
            onClick={() =>
              addBp.mutate(
                { systolic: systolic!, diastolic: diastolic! },
                {
                  onSuccess: () => {
                    setSys('');
                    setDia('');
                    notifications.show({ message: t('nurse.vitals.bpAdded') });
                  },
                },
              )
            }
          >
            {t('nurse.vitals.addBp')}
          </Button>
          {addBp.isError && <Alert color="danger">{errorMessage(t, addBp.error)}</Alert>}
        </Stack>
      )}
    </Stack>
  );
}
