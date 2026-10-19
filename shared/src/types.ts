import type { Permission } from './permissions.js';

/** Interface languages; Arabic is right-to-left. */
export const LANGUAGES = ['ar', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface MeDto {
  id: string;
  name: string;
  kind: 'staff' | 'patient';
  /** Last language the user chose, or null if never. */
  language: Language | null;
  globalPermissions: Permission[];
  centres: { id: string; name: string; permissions: Permission[]; roles?: RoleRef[] }[];
  /** Names of the user's global roles (shown in the user menu). */
  globalRoles?: RoleRef[];
}

/** A role as shown to its holder: built-in roles keep their `key` so the client can translate the name. */
export interface RoleRef {
  key: string;
  name: string;
}
