'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Icon } from '@/components/onyx-ui';

export interface ProfileDetails {
  /** Read here, edited by IdentityEditor -- see its docblock for the split. */
  phone: string | null;
  username: string | null;
  headline: string;
  bio: string;
  skills_text: string;
  interests: string;
  experience: string;
  website: string;
  profile_public: boolean;
}

const field = 'mt-1.5 block w-full rounded-xl border border-line bg-white px-3.5 py-2.5 '
  + 'text-[14px] focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-600/20';
const label = 'block text-[13.5px] font-semibold text-slate-700';

/**
 * The half of a profile only its owner can write.
 *
 * Everything else on this screen is derived -- courses, marks, awarded skills,
 * attendance -- which made it a record rather than a profile. What an employer,
 * a lecturer or another learner actually reads first is the sentence a person
 * writes about themselves, and there was nowhere to write one.
 *
 * The prompts differ by role because the roles differ. Asking a lecturer what
 * they are "interested in learning" is asking the wrong person the wrong
 * question, and an administrator has no skills passport to fill in -- their
 * profile is about who to contact and what they are responsible for.
 *
 * Visibility is a switch, off until it is not, and the address is shown beside
 * it the moment there is one to show. A link somebody cannot see is a link they
 * will not share.
 */
export function ProfileEditor({ details, role, origin }: {
  details: ProfileDetails;
  role: string;
  /** Where the shareable link points, so the field shows the real address. */
  origin: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState<ProfileDetails>(details);

  const set = <K extends keyof ProfileDetails>(key: K, value: ProfileDetails[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  };

  const isStudent = role === 'student';
  const isFaculty = role === 'faculty';

  const words = isStudent
    ? {
      headline: 'Headline',
      headlineHint: 'One line, the way you would introduce yourself. “Final-year CS student, interested in data engineering.”',
      skills: 'Skills',
      skillsHint: 'Comma separated. These sit beside the ones your institution has awarded you.',
      interests: 'Interested in',
      interestsHint: 'What you want to work on or learn next.',
      experience: 'Experience',
      experienceHint: 'Internships, projects, positions of responsibility — in your own words.',
    }
    : isFaculty
      ? {
        headline: 'Title',
        headlineHint: 'How you are introduced. “Associate Professor, Computer Science.”',
        skills: 'Subjects and expertise',
        skillsHint: 'Comma separated. What you teach and what you are asked about.',
        interests: 'Research interests',
        interestsHint: 'What you work on outside teaching.',
        experience: 'Qualifications and positions',
        experienceHint: 'Degrees, appointments, anything a colleague or a parent would want to know.',
      }
      : {
        headline: 'Role at the institution',
        headlineHint: 'What you are responsible for. “Registrar — admissions and records.”',
        skills: 'Responsibilities',
        skillsHint: 'Comma separated. What people should come to you about.',
        interests: 'Also handles',
        interestsHint: 'Anything else that routes to you.',
        experience: 'Background',
        experienceHint: 'Optional. How long you have been here, what you did before.',
      };

  const link = form.username ? origin + '/onyx/p/' + form.username : null;

  const save = () => start(async () => {
    setError(null);
    setSaved(false);
    const res = await fetch('/api/proxy/onyx/my/profile-details', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const body = await res.json().catch(() => ({}));
    if (!body.ok) { setError(body.message ?? 'That did not save.'); return; }
    setSaved(true);
    router.refresh();
  });

  return (
    <Card className="p-4 sm:p-5">
      <div className="space-y-4">
        <div>
          <label className={label} htmlFor="pf-username">Profile address</label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-muted">{origin}/onyx/p/</span>
            <input
              id="pf-username"
              value={form.username ?? ''}
              onChange={(e) => set('username', e.target.value)}
              placeholder={isStudent ? 'your-roll-number' : 'your-name'}
              className="min-h-[42px] flex-1 rounded-xl border border-line bg-white px-3
                         text-[14px] focus:border-brand-500 focus:outline-none"
            />
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted">
            3–40 characters: letters, numbers, dots, dashes or underscores.
            {isStudent ? ' Your roll number works well — it is what your institution calls you.' : ''}
          </p>
        </div>

        {/* The switch and the link together: a person deciding whether to
            publish wants to see exactly what they are publishing to. */}
        <div className="rounded-xl border border-line bg-canvas p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[14px] font-bold">Anyone with the link can see this</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                {form.profile_public
                  ? 'On — your name, what you have written and the institutions you belong to are '
                    + 'visible to anyone with the address. Your email, phone and marks are not.'
                  : 'Off — the address answers to nobody. Nothing about you is public.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.profile_public}
              aria-label="Make my profile public"
              onClick={() => set('profile_public', !form.profile_public)}
              className={'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full '
                + 'transition ' + (form.profile_public ? 'bg-brand-600' : 'bg-slate-300')}
            >
              <span className={'inline-block h-5 w-5 transform rounded-full bg-white transition '
                + (form.profile_public ? 'translate-x-6' : 'translate-x-1')} />
            </button>
          </div>

          {link ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2.5 py-2
                               font-mono text-[12.5px]">{link}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(link);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border
                           border-line bg-white px-3 text-[13px] font-semibold
                           hover:border-brand-300 hover:text-brand-700"
              >
                <Icon name={copied ? 'check' : 'external'} className="h-4 w-4" />
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          ) : (
            <p className="mt-3 text-[12.5px] text-muted">
              Choose a username above and the address appears here.
            </p>
          )}
        </div>

        <div>
          <label className={label} htmlFor="pf-headline">{words.headline}</label>
          <input id="pf-headline" value={form.headline} maxLength={160}
            onChange={(e) => set('headline', e.target.value)} className={field} />
          <p className="mt-1.5 text-[12.5px] text-muted">{words.headlineHint}</p>
        </div>

        <div>
          <label className={label} htmlFor="pf-bio">About you</label>
          <textarea id="pf-bio" value={form.bio} rows={4} maxLength={2000}
            onChange={(e) => set('bio', e.target.value)} className={field} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="pf-skills">{words.skills}</label>
            <input id="pf-skills" value={form.skills_text} maxLength={600}
              onChange={(e) => set('skills_text', e.target.value)}
              placeholder="Python, SQL, Public speaking" className={field} />
            <p className="mt-1.5 text-[12.5px] text-muted">{words.skillsHint}</p>
          </div>
          <div>
            <label className={label} htmlFor="pf-interests">{words.interests}</label>
            <input id="pf-interests" value={form.interests} maxLength={600}
              onChange={(e) => set('interests', e.target.value)}
              placeholder="Machine learning, Robotics" className={field} />
            <p className="mt-1.5 text-[12.5px] text-muted">{words.interestsHint}</p>
          </div>
        </div>

        <div>
          <label className={label} htmlFor="pf-experience">{words.experience}</label>
          <textarea id="pf-experience" value={form.experience} rows={5} maxLength={3000}
            onChange={(e) => set('experience', e.target.value)} className={field} />
          <p className="mt-1.5 text-[12.5px] text-muted">{words.experienceHint}</p>
        </div>

        <div>
          <label className={label} htmlFor="pf-website">Link</label>
          <input id="pf-website" value={form.website} maxLength={200} type="url"
            onChange={(e) => set('website', e.target.value)}
            placeholder="https://" className={field} />
        </div>

        {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}
        {saved && !error ? (
          <p role="status" className="text-[13px] text-emerald-700">Saved.</p>
        ) : null}

        <button type="button" onClick={save} disabled={pending}
          className="min-h-[46px] rounded-xl bg-brand-600 px-5 text-[15px] font-bold text-white
                     hover:bg-brand-700 disabled:opacity-50">
          {pending ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </Card>
  );
}
