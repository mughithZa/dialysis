import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Divider, PasswordInput, Stack, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { errorMessage } from '../../i18n/errors';
import { useCreatePatient, useEditPatient, type PatientDto, type PatientRecord } from './api';

interface Props {
  /** null registers a new patient (with a login); otherwise edits the record. */
  patient: PatientDto | null;
  onDone: () => void;
}

const clean = (s: string) => s.trim() || undefined;

export function PatientForm({ patient, onDone }: Props) {
  const { t } = useTranslation();
  const create = useCreatePatient();
  const edit = useEditPatient();
  const mutation = patient ? edit : create;

  const [name, setName] = useState(patient?.name ?? '');
  const [phone, setPhone] = useState(patient?.phone ?? '');
  const [emName, setEmName] = useState(patient?.emergencyContact.name ?? '');
  const [emPhone, setEmPhone] = useState(patient?.emergencyContact.phone ?? '');
  const [emRelation, setEmRelation] = useState(patient?.emergencyContact.relation ?? '');
  const [cause, setCause] = useState(patient?.kidneyFailureCause ?? '');
  const [address, setAddress] = useState(patient?.address ?? '');
  const [social, setSocial] = useState(patient?.socialSituation ?? '');
  const [financial, setFinancial] = useState(patient?.financialSituation ?? '');
  const [diseases, setDiseases] = useState(patient?.otherDiseases ?? '');
  const [notes, setNotes] = useState(patient?.notes ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const valid = name.trim().length > 0 && (patient !== null || (username.trim().length > 0 && password.length >= 8));

  const record = (): PatientRecord => {
    const emergency = { name: clean(emName), phone: clean(emPhone), relation: clean(emRelation) };
    const hasEmergency = Object.values(emergency).some((v) => v !== undefined);
    const out: PatientRecord = {
      name: name.trim(),
      phone: clean(phone),
      kidneyFailureCause: clean(cause),
      address: clean(address),
      socialSituation: clean(social),
      financialSituation: clean(financial),
      otherDiseases: clean(diseases),
      notes: clean(notes),
      ...(hasEmergency ? { emergencyContact: Object.fromEntries(Object.entries(emergency).filter(([, v]) => v !== undefined)) } : {}),
    };
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
  };

  const submit = () => {
    if (patient) {
      edit.mutate(
        { id: patient.id, ...record() },
        {
          onSuccess: () => {
            notifications.show({ message: t('desk.patients.saved') });
            onDone();
          },
        },
      );
    } else {
      create.mutate(
        { ...record(), login: { username: username.trim(), password } },
        {
          onSuccess: () => {
            notifications.show({ message: t('desk.patients.created') });
            onDone();
          },
        },
      );
    }
  };

  return (
    <Stack
      gap="sm"
      component="form"
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        if (valid) submit();
      }}
    >
      <TextInput label={t('desk.form.name')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <TextInput label={t('desk.form.phone')} type="tel" value={phone} onChange={(e) => setPhone(e.currentTarget.value)} />
      <TextInput label={t('desk.form.emergencyName')} value={emName} onChange={(e) => setEmName(e.currentTarget.value)} />
      <TextInput label={t('desk.form.emergencyPhone')} type="tel" value={emPhone} onChange={(e) => setEmPhone(e.currentTarget.value)} />
      <TextInput label={t('desk.form.emergencyRelation')} value={emRelation} onChange={(e) => setEmRelation(e.currentTarget.value)} />
      <TextInput label={t('desk.form.kidneyFailureCause')} value={cause} onChange={(e) => setCause(e.currentTarget.value)} />
      <TextInput label={t('desk.form.address')} value={address} onChange={(e) => setAddress(e.currentTarget.value)} />
      <Textarea label={t('desk.form.socialSituation')} autosize minRows={2} value={social} onChange={(e) => setSocial(e.currentTarget.value)} />
      <Textarea label={t('desk.form.financialSituation')} autosize minRows={2} value={financial} onChange={(e) => setFinancial(e.currentTarget.value)} />
      <Textarea label={t('desk.form.otherDiseases')} autosize minRows={2} value={diseases} onChange={(e) => setDiseases(e.currentTarget.value)} />
      <Textarea label={t('desk.form.notes')} autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
      {!patient && (
        <>
          <Divider label={t('desk.form.loginSection')} />
          <TextInput label={t('desk.form.username')} autoCapitalize="none" value={username} onChange={(e) => setUsername(e.currentTarget.value)} />
          <PasswordInput label={t('desk.form.password')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
        </>
      )}
      {mutation.isError && <Alert color="danger">{errorMessage(t, mutation.error)}</Alert>}
      <Button type="submit" mih={44} loading={mutation.isPending} disabled={!valid}>
        {patient ? t('common.save') : t('common.create')}
      </Button>
    </Stack>
  );
}
