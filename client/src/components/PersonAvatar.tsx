import { Avatar, type AvatarProps } from '@mantine/core';

/** Up to two initials from a name, e.g. "Nurse 1A" -> "N1", "ياسمين حداد" -> "يح". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => [...w][0] ?? '')
    .join('')
    .toUpperCase();
}

/** A round initials avatar for a patient or staff member (decorative: the name is always shown next to it). */
export function PersonAvatar({ name, size = 40, ...rest }: { name: string } & Omit<AvatarProps, 'children' | 'color' | 'variant'>) {
  return (
    <Avatar radius="xl" size={size} color="uoca" variant="light" aria-hidden {...rest}>
      {initials(name)}
    </Avatar>
  );
}
