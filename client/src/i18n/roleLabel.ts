import type { TFunction } from 'i18next';
import en from './en.json';

const BUILT_IN = en.roleNames as Record<string, string>;

/**
 * Display name of a role: a built-in role still carrying its default English name is shown in the interface
 * language; a renamed or custom role is shown exactly as the program manager typed it.
 */
export function roleLabel(t: TFunction, role: { key?: string | null; name: string }): string {
  const key = role.key ?? '';
  return key in BUILT_IN && BUILT_IN[key] === role.name ? t(`roleNames.${key}`) : role.name;
}
