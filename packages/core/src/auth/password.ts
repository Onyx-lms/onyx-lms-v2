/**
 * F-08 / A-01 -- password verification against the EXISTING users table.
 *
 * Laravel hashes with bcrypt cost 10 and PHP writes the `$2y$` prefix. `$2y$`
 * and `$2a$` are the same algorithm -- `$2y$` was PHP's marker after the 2011
 * crypt_blowfish sign-extension fix. bcryptjs only recognises $2a/$2b/$2x, so
 * the prefix is normalised before comparing.
 *
 * This is what lets every existing password keep working with no reset email
 * and no migration. Verified in test/auth.test.ts against a real hash lifted
 * from the production users table.
 */
import bcrypt from 'bcryptjs';

const LARAVEL_COST = 10;

/** Normalise a PHP `$2y$` hash to the `$2a$` bcryptjs understands. */
export function normalizeHash(hash: string): string {
  return hash.startsWith('$2y$') ? '$2a$' + hash.slice(4) : hash;
}

export async function verifyPassword(plain: string, storedHash: string): Promise<boolean> {
  if (!plain || !storedHash) return false;
  try {
    return await bcrypt.compare(plain, normalizeHash(storedHash));
  } catch {
    return false;
  }
}

/**
 * Hash a new password. Emits a `$2y$` prefix so rows written by Node are
 * byte-compatible with rows written by Laravel -- required during a phased
 * cutover where both stacks may be live against one database.
 */
export async function hashPassword(plain: string, cost = LARAVEL_COST): Promise<string> {
  const hash = await bcrypt.hash(plain, cost);
  return hash.startsWith('$2a$') ? '$2y$' + hash.slice(4) : hash;
}
