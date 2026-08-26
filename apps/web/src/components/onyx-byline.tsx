import { Icon } from '@/components/onyx-ui';

/**
 * Who made this, on the screens that list what was made.
 *
 * Four things record an author -- a question bank, a paper, a sitting and a
 * course module -- and until now every one of them showed an anonymous row.
 * The question is asked constantly and from both directions: an institution
 * finding a sitting it did not schedule wants to know the platform did it, and
 * an operator finding one they did not schedule wants to know the institution
 * did. Neither could tell.
 *
 * The role is shown beside the name rather than instead of it, because both
 * halves are load-bearing and they answer different questions. "Anjali Rao"
 * says who to go and ask; "Faculty" says whether they had standing to do it at
 * all. On a paper set by the console the second half is the whole answer.
 *
 * Not recorded is said plainly. Every module written before 0042 has no author
 * and never will -- a dash would read as a rendering fault, and inventing a
 * name would be worse than either.
 */
export interface Author {
  id: string;
  name: string;
  email?: string | null;
  role: 'superadmin' | 'admin' | 'faculty' | 'exams' | 'student' | 'member';
}

/** How each role reads in a sentence. Mirrors AUTHOR_ROLE_LABELS in core. */
const ROLE_LABELS: Record<Author['role'], string> = {
  superadmin: 'Platform',
  admin: 'Administrator',
  faculty: 'Faculty',
  exams: 'Examinations office',
  student: 'Student',
  member: 'Member',
};

export function Byline({ author, verb, className }: {
  author?: Author | null;
  /**
   * What they did, so a byline reads as a sentence rather than a label.
   * "Set by", "Scheduled by", "Added by" -- the screen knows, this does not.
   */
  verb?: string;
  className?: string;
}) {
  if (!author) {
    return (
      <span className={'text-[12.5px] italic text-faint ' + (className ?? '')}>
        Not recorded
      </span>
    );
  }
  const platform = author.role === 'superadmin';
  return (
    <span className={'inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 '
      + 'text-[12.5px] leading-snug ' + (className ?? '')}
      title={author.email ?? undefined}>
      {verb ? <span className="text-muted">{verb}</span> : null}
      <span className="font-semibold text-ink">{author.name}</span>
      {/*
        * The platform is called out rather than listed as one role among six.
        * "Faculty" and "Administrator" are both people at this institution and
        * differ only in standing; the platform operator is somebody from
        * OUTSIDE it acting on its behalf, which is a different kind of fact
        * and the one an institution most wants to notice.
        */}
      <span className={'inline-flex items-center gap-1 rounded-md px-1.5 py-px '
        + 'text-[11px] font-bold uppercase tracking-[.04em] '
        + (platform
          ? 'bg-accent-50 text-accent-800'
          : 'bg-slate-100 text-muted')}>
        {platform ? <Icon name="shield" className="h-3 w-3" /> : null}
        {ROLE_LABELS[author.role]}
      </span>
    </span>
  );
}
