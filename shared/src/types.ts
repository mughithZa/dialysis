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
  centres: { id: string; name: string; permissions: Permission[] }[];
}
