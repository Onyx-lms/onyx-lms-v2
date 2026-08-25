import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Icon } from '@/components/onyx-ui';
import { appOrigin } from '@/lib/app-origin';

interface PublicProfile {
  username: string;
  name: string;
  headline: string;
  bio: string;
  skills: string[];
  interests: string[];
  experience: string;
  website: string;
  since: string;
  places: { role: string; since: string; institution: string }[];
}

const ROLE_WORD: Record<string, string> = {
  student: 'Student', faculty: 'Faculty', admin: 'Administrator',
  exams: 'Examinations', placement: 'Placement', employer: 'Employer',
  guardian: 'Parent or guardian',
};

/*
 * Never cached.
 *
 * Without this Next renders the page once per handle and serves that copy: a
 * profile switched off carried on answering to anyone holding the link, which
 * is the one failure this feature must not have. A profile is also edited far
 * more often than it is read by any one person, so a stale copy is the wrong
 * trade even setting privacy aside.
 */
export const dynamic = 'force-dynamic';

/**
 * Read directly rather than through `apiSafe`, which caches for 60 seconds.
 *
 * That is the right default for catalogue content and the wrong one here: a
 * profile switched off has to stop answering NOW, not within the minute, and
 * `force-dynamic` on the page does not reach inside a cached fetch. The one
 * place privacy and caching disagree, privacy decides.
 */
async function load(username: string): Promise<PublicProfile | null> {
  try {
    const res = await fetch(appOrigin() + '/api/onyx/p/' + encodeURIComponent(username),
      { cache: 'no-store' });
    const body = await res.json().catch(() => ({ ok: false }));
    return body.ok ? (body.data as PublicProfile) : null;
  } catch {
    return null;
  }
}

export async function generateMetadata(
  { params }: { params: Promise<{ username: string }> },
): Promise<Metadata> {
  const { username } = await params;
  const profile = await load(username);
  if (!profile) return { title: 'Profile' };
  return {
    title: profile.name,
    description: profile.headline || ('Profile of ' + profile.name + ' on Onyx.'),
    // The link is meant to be shared, so it should unfurl into something worth
    // clicking rather than the site's default card.
    openGraph: { title: profile.name, description: profile.headline },
  };
}

/**
 * Somebody's profile, at an address they can send to a person.
 *
 * Deliberately outside the signed-in shell: no sidebar, no institution
 * switcher, nothing that belongs to a session. Somebody following this link is
 * usually not a member of anything here -- an employer, a parent, another
 * institution -- and a page that greets them with a navigation menu for a
 * product they do not use is a page that reads as a mistake.
 *
 * A missing handle and a profile that is switched off are the same 404, so the
 * address cannot be used to find out who exists.
 */
export default async function PublicProfilePage(
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const profile = await load(username);
  if (!profile) notFound();

  const initials = profile.name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((w) => w[0]!.toUpperCase()).join('');
  const joined = new Date(profile.since).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-canvas">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
        <header className="flex flex-wrap items-start gap-5">
          <span aria-hidden="true"
            className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-gradient-to-br
                       from-brand-500 to-brand-700 text-[26px] font-extrabold text-white">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">
              {profile.name}
            </h1>
            {profile.headline ? (
              <p className="mt-1 text-[15.5px] leading-relaxed text-slate-700">
                {profile.headline}
              </p>
            ) : null}

            {/* Where they belong, and as what -- the fact that makes the rest of
                the page mean something. A skill claimed by nobody in particular
                is a word; the same skill next to an institution is a claim
                somebody stands behind. */}
            <div className="mt-3 flex flex-wrap gap-2">
              {profile.places.map((p) => (
                <span key={p.institution + p.role}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line
                             bg-white px-3 py-1 text-[12.5px] font-semibold">
                  <Icon name="building" className="h-3.5 w-3.5 text-brand-600" />
                  {p.institution}
                  <span className="font-normal text-muted">
                    · {ROLE_WORD[p.role] ?? p.role}
                  </span>
                </span>
              ))}
            </div>

            <p className="mt-2.5 text-[12.5px] text-muted">
              On Onyx since {joined}
              {profile.website ? ' · ' : ''}
              {profile.website ? (
                <a href={profile.website} rel="nofollow noopener noreferrer" target="_blank"
                  className="font-semibold text-brand-700 hover:underline">
                  {profile.website.replace(/^https?:\/\//, '')}
                </a>
              ) : null}
            </p>
          </div>
        </header>

        {profile.bio ? (
          <section className="mt-8">
            <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">About</h2>
            <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">
              {profile.bio}
            </p>
          </section>
        ) : null}

        {profile.skills.length ? (
          <section className="mt-8">
            <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
              Skills
            </h2>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {profile.skills.map((s) => (
                <li key={s}
                  className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1
                             text-[13px] font-semibold text-brand-700">
                  {s}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {profile.interests.length ? (
          <section className="mt-8">
            <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
              Interested in
            </h2>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {profile.interests.map((s) => (
                <li key={s}
                  className="rounded-full border border-line bg-white px-3 py-1 text-[13px]">
                  {s}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {profile.experience ? (
          <section className="mt-8">
            <h2 className="text-[11.5px] font-bold uppercase tracking-[.085em] text-muted">
              Experience
            </h2>
            <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-slate-700">
              {profile.experience}
            </p>
          </section>
        ) : null}

        {/* Nothing derived is shown here -- no marks, no attendance, no
            enrolments. Those belong to the institution and to the person, and a
            public page is not where either of them agreed to put them. */}
        <footer className="mt-12 border-t border-line pt-5 text-[12.5px] text-muted">
          This profile is published by its owner. Marks, attendance and enrolments are
          never shown here.{' '}
          <Link href="/onyx/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>{' '}
          if you have an account.
        </footer>
      </div>
    </div>
  );
}
