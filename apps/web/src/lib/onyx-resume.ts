/**
 * The shape `GET /api/onyx/my/resume` returns.
 *
 * Mirrors `ResumeDocument` in packages/core rather than importing it: the web
 * app reads this over HTTP, and typing the wire format as the service's own
 * return type would hide the day the two stop agreeing.
 */

export interface ResumeItem {
  /** "course:12", "cert:8" -- what `hidden` names. */
  key: string;
  title: string;
  subtitle: string;
  detail: string;
  when: string;
}

/** One typed-in entry. `id` is the server's and is what `hidden` names. */
export interface ResumeExtra {
  id: number;
  section: string;
  title: string;
  detail: string;
  when: string;
}

export interface ResumeSectionView {
  key: string;
  label: string;
  items: ResumeItem[];
}

export interface ResumeDoc {
  name: string;
  headline: string;
  email: string;
  phone: string;
  website: string;
  /** The setting, which is not the same as whether a number came out. */
  include_phone: boolean;
  institution: string;
  title: string;
  objective: string;
  sections: ResumeSectionView[];
  /** Everything the resume COULD show, hidden entries included. */
  available: { key: string; label: string; section: string }[];
  /** The entries this person typed, as stored -- editable and removable. */
  extras: ResumeExtra[];
  /** The effective order: their choices, then the rest in the default order. */
  section_order: string[];
  hidden: string[];
  /** True when the PDF's font cannot set this person's name. */
  pdf_will_mangle: boolean;
}

/** The section headings, in the order the service assembles them. */
export const RESUME_SECTION_LABELS: Record<string, string> = {
  objective: 'Objective',
  education: 'Education',
  experience: 'Experience',
  skills: 'Skills',
  courses: 'Courses',
  certificates: 'Certificates',
  projects: 'Projects',
  extras: 'Also',
};
