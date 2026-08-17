/**
 * Where the Laravel source database lives.
 *
 * This repository is generated FROM the Laravel app's schema, so the parity and
 * import tools read its SQLite file. The two repositories are separate, so the
 * path is configurable:
 *
 *   LARAVEL_ROOT   path to the Laravel checkout
 *                  (default: ../TT002-LEO-LMS, i.e. a sibling directory)
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = new URL('../../', import.meta.url).pathname.replace(/^[/]([A-Za-z]:)/, '$1');

export function laravelRoot() {
  return process.env.LARAVEL_ROOT ?? path.join(REPO, '..', 'TT002-LEO-LMS');
}

export function laravelDb() {
  const file = path.join(laravelRoot(), 'database', 'database.sqlite');
  if (!fs.existsSync(file)) {
    throw new Error([
      'Cannot find the Laravel source database at:',
      '  ' + path.resolve(file),
      'Set LARAVEL_ROOT to the Laravel checkout.',
    ].join('\n'));
  }
  return file;
}
