import { useTranslation } from 'react-i18next';
import { Avatar, Menu, Stack, Text, UnstyledButton } from '@mantine/core';
import { IconCheck, IconLanguage, IconLogout } from '@tabler/icons-react';
import { LANGUAGES, type MeDto } from '@dialysis/shared';
import { useAuth, useCentre } from '../auth/AuthProvider';
import { setLanguage } from '../i18n';
import { formatList } from '../i18n/format';
import { roleLabel } from '../i18n/roleLabel';

/** Up to two initials from a name, e.g. "Nurse 1A" -> "N1", "ياسمين حداد" -> "يح". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => [...w][0] ?? '')
    .join('')
    .toUpperCase();
}

/** The user's roles in the current centre plus any global ones, translated where built in. */
function useRoleLine(me: MeDto | null, centreId: string | null): string {
  const { t } = useTranslation();
  if (!me) return '';
  if (me.kind === 'patient') return t('userMenu.patient');
  const roles = [...(me.globalRoles ?? []), ...(me.centres.find((c) => c.id === centreId)?.roles ?? [])];
  const names = [...new Set(roles.map((r) => roleLabel(t, r)))];
  return names.length ? formatList(names) : t('userMenu.staff');
}

/** Avatar button in the header: who is signed in, their role, the language switch and sign out. */
export function UserMenu({ onLogout }: { onLogout: () => void }) {
  const { t, i18n } = useTranslation();
  const { me } = useAuth();
  const { centreId } = useCentre();
  const roleLine = useRoleLine(me, centreId);
  if (!me) return null;
  return (
    <Menu position="bottom-end" width={260} withinPortal>
      <Menu.Target>
        <UnstyledButton aria-label={t('userMenu.label')} mih={44} miw={44} style={{ display: 'grid', placeItems: 'center' }}>
          <Avatar radius="xl" size={38} color="uoca" variant="filled" styles={{ placeholder: { background: 'var(--uoca-gold)', color: 'var(--uoca-text)' } }}>
            {initials(me.name)}
          </Avatar>
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Stack gap={0} px="sm" py={6}>
          <Text fw={700} truncate>
            {me.name}
          </Text>
          <Text size="sm" c="dimmed" lineClamp={2}>
            {roleLine}
          </Text>
        </Stack>
        <Menu.Divider />
        <Menu.Label>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <IconLanguage size={14} aria-hidden />
            {t('language.label')}
          </span>
        </Menu.Label>
        {LANGUAGES.map((l) => (
          <Menu.Item
            key={l}
            lang={l}
            mih={44}
            aria-current={i18n.language === l ? 'true' : undefined}
            rightSection={i18n.language === l ? <IconCheck size={16} aria-hidden /> : undefined}
            onClick={() => void setLanguage(l)}
          >
            {t(`language.${l}`)}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item mih={44} color="danger" leftSection={<IconLogout size={18} aria-hidden />} onClick={onLogout}>
          {t('common.logout')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
