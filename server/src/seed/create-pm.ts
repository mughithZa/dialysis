import { Role } from '../auth/role.model.js';
import { User } from '../auth/user.model.js';
import { hashPassword } from '../auth/password.js';
import { seedRoles } from '../auth/roles.seed.js';

export interface NewPm {
  username: string;
  name: string;
  password: string;
}

/** Reads CREATE_PM_USERNAME / CREATE_PM_NAME / CREATE_PM_PASSWORD; throws a readable message when invalid. */
export function pmFromEnv(env: NodeJS.ProcessEnv): NewPm {
  const username = env.CREATE_PM_USERNAME?.trim();
  const name = env.CREATE_PM_NAME?.trim();
  const password = env.CREATE_PM_PASSWORD ?? '';
  if (!username) throw new Error('CREATE_PM_USERNAME is required');
  if (!name) throw new Error('CREATE_PM_NAME is required');
  if (password.length < 8) throw new Error('CREATE_PM_PASSWORD must be at least 8 characters');
  return { username, name, password };
}

/** Ensures the default roles, then creates the first program manager; refuses if one already exists. */
export async function createProgramManager(pm: NewPm): Promise<void> {
  await seedRoles();
  const role = await Role.findOne({ key: 'program_manager' });
  if (!role) throw new Error('program_manager role is missing');
  if (await User.exists({ globalRoleIds: role._id })) throw new Error('a program manager already exists; nothing created');
  if (await User.exists({ username: pm.username.toLowerCase() })) throw new Error(`username "${pm.username}" is taken`);
  await User.create({
    username: pm.username,
    passwordHash: await hashPassword(pm.password),
    name: pm.name,
    kind: 'staff',
    globalRoleIds: [role._id],
  });
}
