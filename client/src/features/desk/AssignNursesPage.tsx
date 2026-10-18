import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Group, Loader, Select, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useCan } from '../../auth/useCan';
import { errorMessage } from '../../i18n/errors';
import { useCentreUsers } from '../centre/api';
import { useAssignChairs, useAssignments, useGrid } from './api';

export function AssignNursesPage() {
  const { t } = useTranslation();
  const grid = useGrid();
  const assignments = useAssignments();
  const users = useCentreUsers();
  const assign = useAssignChairs();
  const canAssign = useCan('schedule.assignNurses');
  const [shiftId, setShiftId] = useState<string | null>(null);

  const shifts = grid.data?.shifts.filter((s) => s.active) ?? [];
  const shift = shifts.find((s) => s.id === shiftId) ?? shifts[0];
  const chairs = grid.data?.chairs.filter((c) => c.active) ?? [];
  const nurses = (users.data ?? []).filter((u) => u.active && u.roleKeys.includes('nurse'));
  const forShift = (assignments.data ?? []).filter((a) => a.shiftId === shift?.id);
  const nurseOf = (chairId: string) => forShift.find((a) => a.chairId === chairId)?.nurseId ?? null;
  const chairsOf = (nurseId: string) => forShift.filter((a) => a.nurseId === nurseId).map((a) => a.chairId);

  /** Sets this chair's nurse. The server replaces a nurse's whole set, so send the full new set. */
  const setNurse = async (chairId: string, nurseId: string | null) => {
    if (!shift) return;
    const previous = nurseOf(chairId);
    if (previous === nurseId) return;
    try {
      if (nurseId) {
        // Assigning takes the chair over from its previous nurse on the server.
        await assign.mutateAsync({ shiftId: shift.id, nurseId, chairIds: [...chairsOf(nurseId).filter((c) => c !== chairId), chairId] });
      } else if (previous) {
        await assign.mutateAsync({ shiftId: shift.id, nurseId: previous, chairIds: chairsOf(previous).filter((c) => c !== chairId) });
      }
      notifications.show({ message: t('desk.assign.saved') });
    } catch {
      // surfaced through assign.error below
    }
  };

  const loading = grid.isPending || assignments.isPending || users.isPending;
  const error = grid.error ?? assignments.error ?? users.error;

  return (
    <Stack gap="md">
      <Title order={2}>{t('desk.assign.title')}</Title>
      {loading && <Loader />}
      {error && <Alert color="danger">{errorMessage(t, error)}</Alert>}
      {assign.isError && <Alert color="danger">{errorMessage(t, assign.error)}</Alert>}
      {grid.data && shifts.length === 0 && <Text c="dimmed">{t('desk.assign.noShifts')}</Text>}
      {users.data && nurses.length === 0 && <Text c="dimmed">{t('desk.assign.noNurses')}</Text>}
      {shift && (
        <Select
          label={t('desk.assign.shift')}
          allowDeselect={false}
          value={shift.id}
          onChange={setShiftId}
          data={shifts.map((s) => ({ value: s.id, label: `${s.name} (${s.start}-${s.end})` }))}
        />
      )}
      {shift &&
        assignments.data &&
        chairs.map((c) => (
          <Group key={c.id} wrap="nowrap" align="flex-end">
            <Select
              style={{ flex: 1 }}
              label={c.label}
              placeholder={t('desk.assign.nurse')}
              clearable
              disabled={!canAssign || assign.isPending}
              value={nurseOf(c.id)}
              onChange={(v) => void setNurse(c.id, v)}
              data={nurses.map((n) => ({ value: n.id, label: n.name }))}
              clearButtonProps={{ 'aria-label': t('desk.assign.clear', { chair: c.label }) }}
            />
          </Group>
        ))}
    </Stack>
  );
}
