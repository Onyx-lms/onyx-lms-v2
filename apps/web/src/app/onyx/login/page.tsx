import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { OnyxLoginForm } from '@/components/onyx-auth-forms';
import { OnyxAuthSplit } from '@/components/onyx-auth-split';
import { Icon } from '@/components/onyx-ui';
import { getOnyxSession } from '@/lib/onyx-session';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * F-06 -- signing in.
 *
 * No shell at all: no sidebar, no tab bar, no header. There is nothing to
 * navigate to before you are signed in, and every piece of chrome on an auth
 * page is another thing to look at instead of the two fields.
 *
 * The layout is `OnyxAuthSplit` — a calm white column for the form and a teal
 * panel beside it — and the panel is where this door announces itself. Two
 * doors share this product one path segment apart, so the word "Institution"
 * appears on every breakpoint, in the panel on a desktop and in the brand bar
 * on a phone. Somebody arriving from an emailed link should not have to read
 * the URL to know whose password they are typing.
 *
 * The form itself -- its labels, its error announcement, the request it makes
 * and the cookie that comes back -- is `OnyxLoginForm`, and is untouched by
 * this page. Everything here is the surface it sits on.
 */
/**
 * Where to land after signing in, when something sent us here from a page that
 * needed a session.
 *
 * An open redirect is the classic way to get this wrong: `?next=https://evil`
 * on a link that otherwise looks like the real login is a credible phishing
 * hop, and `//evil.example` is the same trick spelled so it still reads as a
 * path. Only a single-slash absolute path inside this app is accepted;
 * anything else silently falls back to the dashboard.
 */
function safeNext(next: string | undefined): string | undefined {
  if (!next) return undefined;
  if (!next.startsWith('/') || next.startsWith('//')) return undefined;
  return next;
}

export default async function OnyxLoginPage(
  { searchParams }: { searchParams: Promise<{ next?: string }> },
) {
  const next = safeNext((await searchParams).next);
  if (await getOnyxSession()) redirect(next ?? '/onyx/dashboard');

  return (
    <OnyxAuthSplit
      tone="institution"
      title="Sign in to Onyx"
      subtitle="Your account works across every institution you belong to."
      claim="Everything your institution runs, in one place."
      points={[
        { icon: 'book', text: 'Courses, lessons and progress that follows the learner' },
        { icon: 'shield', text: 'Assessments and monitored exams' },
        { icon: 'briefcase', text: 'Attendance, placements and verifiable credentials' },
      ]}
      note="No video is recorded. Monitoring stores events, never footage."
      footer={
        <>
          {/* The one thing about this product that is not obvious from the
              form: the account is not owned by an institution. Said here
              rather than in a help article, because the person who needs it is
              the one holding two invitations and wondering which login to
              use. */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-canvas p-4
                          text-[13px] leading-relaxed text-muted">
            <span className="text-brand-600">
              <Icon name="building" className="mt-0.5 h-4 w-4" />
            </span>
            <p className="min-w-0 flex-1">
              One account, every institution. If you belong to more than one, you choose
              which after signing in &mdash; and you can switch at any time.
            </p>
          </div>

          {/* No "start a new institution" link any more: institutions are
              created by the platform team, from the platform console, so
              inviting somebody to self-serve here would only lead them to a
              page explaining that they cannot. */}
          <p className="mt-4 text-[13px] text-muted">
            Institutions are set up by the Onyx platform team.
          </p>
        </>
      }
    >
      <OnyxLoginForm next={next} />
    </OnyxAuthSplit>
  );
}
