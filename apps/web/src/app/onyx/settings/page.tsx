import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { requireOnyxPageRole, onyxApi, type Me } from '@/lib/onyx-session';
import {
  CommunityLinkForm, FacultyExamPermissionToggle, StudentSignupSettings,
} from '@/components/onyx-settings';
import { SectionHead } from '@/components/onyx-ui';

export const metadata: Metadata = { title: 'Settings' };

/**
 * F-07 -- how this institution runs, rather than what is in it.
 *
 * This page held one switch: whether faculty could schedule an examination.
 * That switch was right, and the shape it implied was wrong -- every other
 * "who is allowed to do this" answer in the product was a role list written
 * into a route, so an institution could be asked how it runs examinations and
 * nothing else. Colleges differ on far more than that: who adds students, who
 * writes question banks, who publishes results, who touches the fee ledger.
 *
 * The matrix is now the page, and the exam switch stays underneath it, because
 * it means something the matrix does not: an institution that switched faculty
 * scheduling off before the matrix existed keeps that answer, and the exams
 * route reads the flag as a floor on top of the capability.
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
      <div className="space-y-7">
        {/*
          * Permissions moved to their own screen ("Roles and permissions").
          *
          * This page had both, which put "how this institution runs" and "who
          * is allowed to run it" under one heading. They are different
          * questions, asked by different people at different times -- a
          * settings page is about the site, and authority is not a setting.
          */}
        <section>
          <SectionHead title="Community" />
          <CommunityLinkForm
            url={me.tenant.community_url ?? ''}
            label={me.tenant.community_label ?? ''}
          />
        </section>

        {/* Named for what it is rather than for its area: the matrix above
            already has an "Examinations" heading, and two sections with the
            same name on one page is a page nobody can give directions around.
            This one is not a duplicate of the matrix row -- it is the older,
            narrower switch the exams route still reads as a floor. */}
        <section>
          <SectionHead title="Student registration" />
          <StudentSignupSettings
            enabled={me.tenant.student_signup === true}
            domains={me.tenant.signup_domains ?? ''}
            mode={me.tenant.signup_mode === 'open' ? 'open' : 'domain'}
          />
        </section>

        <section>
          <SectionHead title="Faculty exam scheduling" />
          <FacultyExamPermissionToggle
            enabled={me.tenant.faculty_can_schedule_exams !== false}
          />
        </section>
      </div>
    </OnyxShell>
  );
}
