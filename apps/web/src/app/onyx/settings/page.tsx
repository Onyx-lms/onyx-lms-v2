import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, type Me } from '@/lib/onyx-session';
import { FacultyExamPermissionToggle } from '@/components/onyx-settings';
import { SectionHead } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Settings' };

/**
 * F-07 -- institution-level settings. Admin only, and one setting so far.
 *
 * This did not exist before: an institution had exactly one fixed answer to
 * "who may schedule an exam" (admin, the exams office, or any faculty
 * member teaching that course), and nothing anywhere let an admin change it.
 * The page exists to hold that choice, and whatever else becomes an
 * institution-wide switch rather than a per-record setting later.
 */
export default async function OnyxSettingsPage() {
  await requireOnyxPageRole('admin');
  const me = await onyxApi<Me>('/api/onyx/me');

  return (
    <OnyxShell
      me={me}
      nav={navFor(me.role)}
      title="Settings"
      subtitle={'How ' + me.tenant.name + ' runs, not what is in it.'}
    >
      <section>
        <SectionHead title="Examinations" />
        <FacultyExamPermissionToggle
          enabled={me.tenant.faculty_can_schedule_exams !== false}
        />
      </section>
    </OnyxShell>
  );
}
