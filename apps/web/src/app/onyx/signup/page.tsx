import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { OnyxSignUpForm } from '@/components/onyx-signup-form';
import { OnyxAuthSplit } from '@/components/onyx-auth-split';
import { Icon } from '@/components/onyx-ui';
import { getOnyxSession } from '@/lib/onyx-session';

export const metadata: Metadata = { title: 'Create an account' };

/**
 * Self-registration, for learners.
 *
 * Every other account in this product is created by somebody with authority:
 * an administrator adds a member, the platform adds an administrator. This is
 * the one door a person opens themselves, and it is deliberately narrow --
 * students only, at an institution that has switched registration on, resolved
 * from the address that institution issued.
 *
 * The page exists whether or not any institution has opened registration; what
 * changes is the answer the form gives once an address is typed. That is a
 * better failure than a 404, which would leave a learner following a link from
 * their college wondering whether the link was wrong.
 */
export default async function OnyxSignUpPage() {
  if (await getOnyxSession()) redirect('/onyx/dashboard');

  return (
    <OnyxAuthSplit
      tone="institution"
      title="Create your account"
      subtitle="For learners whose institution has opened registration."
      claim="One account, for everything your institution runs."
      points={[
        { icon: 'book', text: 'Your courses, lessons and progress in one place' },
        { icon: 'calendar', text: 'Your timetable, register and results' },
        { icon: 'award', text: 'Credentials an employer can verify without an account' },
      ]}
      note="Your roll number is how marks, seating and registers find you."
      footer={
        <>
          <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-canvas p-4
                          text-[13px] leading-relaxed text-muted">
            <span className="text-brand-600">
              <Icon name="building" className="mt-0.5 h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1">
              Use the email address your institution gave you. It is what tells us which
              institution you belong to &mdash; a personal address will not find one.
            </p>
          </div>

          <p className="mt-4 text-[13px] text-muted">
            Already have an account?{' '}
            <Link href="/onyx/login" className="font-semibold text-brand-700 hover:underline">
              Sign in
            </Link>
            .
          </p>
        </>
      }
    >
      <OnyxSignUpForm />
    </OnyxAuthSplit>
  );
}
