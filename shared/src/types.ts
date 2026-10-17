import type { Permission } from './permissions.js';

export interface MeDto {
  id: string;
  name: string;
  kind: 'staff' | 'patient';
  globalPermissions: Permission[];
  centres: { id: string; name: string; permissions: Permission[] }[];
}
