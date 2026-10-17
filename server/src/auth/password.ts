import bcrypt from 'bcryptjs';

export const hashPassword = (p: string): Promise<string> => bcrypt.hash(p, 10);
export const verifyPassword = (p: string, hash: string): Promise<boolean> => bcrypt.compare(p, hash);
