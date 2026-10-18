import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Loader, NumberInput, Stack, Switch, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useSaveSettings, useSettings, type CentreSettings } from './api';

const validHours = (v: number | string) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 72;

function SettingsForm({ initial }: { initial: CentreSettings }) {
  const { t } = useTranslation();
  const save = useSaveSettings();
  const canEdit = useCan('settings.centre');
  const [seeNotes, setSeeNotes] = useState(initial.patientsSeeNotes);
  const [hours, setHours] = useState<number | string>(initial.reminderHours);
  const ok = validHours(hours);

  return (
    <Stack
      gap="md"
      maw={480}
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (!ok || !canEdit) return;
        save.mutate(
          { patientsSeeNotes: seeNotes, reminderHours: hours as number },
          { onSuccess: () => notifications.show({ message: t('centre.settings.saved') }) },
        );
      }}
    >
      <Switch size="md" label={t('centre.settings.patientsSeeNotes')} checked={seeNotes} onChange={(e) => setSeeNotes(e.currentTarget.checked)} disabled={!canEdit} />
      <NumberInput
        label={t('centre.settings.reminderHours')}
        value={hours}
        onChange={setHours}
        allowDecimal={false}
        allowNegative={false}
        error={ok ? undefined : t('centre.settings.reminderInvalid')}
        disabled={!canEdit}
      />
      {save.isError && <Alert color="danger">{errorMessage(t, save.error)}</Alert>}
      {canEdit && (
        <Button type="submit" mih={44} loading={save.isPending} disabled={!ok}>
          {t('common.save')}
        </Button>
      )}
    </Stack>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettings();
  return (
    <Stack gap="md">
      <Title order={2}>{t('centre.settings.title')}</Title>
      {settings.isPending && <Loader />}
      {settings.isError && <Alert color="danger">{errorMessage(t, settings.error)}</Alert>}
      {settings.data && <SettingsForm initial={settings.data} />}
    </Stack>
  );
}
