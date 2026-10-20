import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Group, Loader, NumberInput, Stack, Switch, Text } from '@mantine/core';
import { IconBell, IconDeviceMobile, IconDeviceFloppy, IconLock } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { PageHeader } from '../../components/PageHeader';
import { SectionCard } from '../../components/SectionCard';
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
  const dirty = seeNotes !== initial.patientsSeeNotes || hours !== initial.reminderHours;

  return (
    <Stack
      gap="md"
      maw={640}
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
      {!canEdit && (
        <Alert color="slate" icon={<IconLock size={18} />}>
          {t('centre.settings.readOnly')}
        </Alert>
      )}
      <SectionCard icon={IconDeviceMobile} title={t('centre.settings.patientApp')} hint={t('centre.settings.patientAppHint')}>
        <Switch
          size="md"
          label={t('centre.settings.patientsSeeNotes')}
          description={t('centre.settings.patientsSeeNotesHint')}
          checked={seeNotes}
          onChange={(e) => setSeeNotes(e.currentTarget.checked)}
          disabled={!canEdit}
        />
      </SectionCard>
      <SectionCard icon={IconBell} title={t('centre.settings.reminders')} hint={t('centre.settings.remindersHint')}>
        <NumberInput
          label={t('centre.settings.reminderHours')}
          description={t('centre.settings.reminderHoursHint')}
          value={hours}
          onChange={setHours}
          allowDecimal={false}
          allowNegative={false}
          min={1}
          max={72}
          maw={240}
          rightSection={
            <Text size="sm" c="dimmed" pe="xs">
              {t('centre.settings.hoursUnit')}
            </Text>
          }
          rightSectionWidth={60}
          error={ok ? undefined : t('centre.settings.reminderInvalid')}
          disabled={!canEdit}
        />
      </SectionCard>
      {save.isError && <Alert color="danger">{errorMessage(t, save.error)}</Alert>}
      {canEdit && (
        <Group justify="flex-end">
          <Button
            type="submit"
            mih={44}
            loading={save.isPending}
            disabled={!ok}
            variant={dirty ? 'filled' : 'light'}
            leftSection={<IconDeviceFloppy size={18} aria-hidden />}
          >
            {t('common.save')}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

export function SettingsPage() {
  const { t } = useTranslation();
  const settings = useSettings();
  return (
    <Stack gap="md">
      <PageHeader title={t('centre.settings.title')} subtitle={t('centre.settings.subtitle')} />
      {settings.isPending && <Loader />}
      {settings.isError && <Alert color="danger">{errorMessage(t, settings.error)}</Alert>}
      {settings.data && <SettingsForm initial={settings.data} />}
    </Stack>
  );
}
