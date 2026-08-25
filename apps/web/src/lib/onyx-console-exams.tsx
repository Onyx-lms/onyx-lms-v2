/**
 * The two-tab shape Examinations and Assessments share in the console.
 *
 * Both sections carry the same pair of jobs — the SCHEDULE (what is being sat,
 * when, by which section, and how it went) and the BANK (the sets a setter
 * authors, weeks earlier and usually by a different person). They were one
 * page each, so scheduling meant scrolling past a composer and authoring meant
 * scrolling past a calendar.
 *
 * The tab strips live here rather than in each page so the two halves cannot
 * drift apart: a route added on one side and forgotten on the other is the
 * failure this prevents.
 */
import { SubTabs } from '@/components/onyx-subtabs';

const at = (tenantId: number | string) =>
  '/onyx/platform/tenants/' + encodeURIComponent(String(tenantId));

export function ExamTabs({ tenantId, scheduled, papers }: {
  tenantId: number | string; scheduled?: number; papers?: number;
}) {
  return (
    <SubTabs tabs={[
      { href: at(tenantId) + '/examinations', label: 'Exam schedule', count: scheduled },
      { href: at(tenantId) + '/examinations/papers', label: 'Exam paper', count: papers },
    ]} />
  );
}

/**
 * The same two halves on the institution's own screens.
 *
 * The routes differ -- a lecturer works at `/onyx/exams`, an operator at
 * `/onyx/platform/tenants/7/examinations` -- but the split is the same split
 * and the labels have to match, because the client asked for one arrangement
 * and will be shown both.
 */
export function FacultyExamTabs({ scheduled, papers }: {
  scheduled?: number; papers?: number;
}) {
  return (
    <SubTabs tabs={[
      { href: '/onyx/exams', label: 'Exam schedule', count: scheduled },
      { href: '/onyx/exams/papers', label: 'Exam paper', count: papers },
    ]} />
  );
}

export function FacultyAssessmentTabs({ scheduled, banks }: {
  scheduled?: number; banks?: number;
}) {
  return (
    <SubTabs tabs={[
      { href: '/onyx/assessments', label: 'Assessment schedule', count: scheduled },
      { href: '/onyx/assessments/banks', label: 'Assessment question bank', count: banks },
    ]} />
  );
}

export function AssessmentTabs({ tenantId, scheduled, banks }: {
  tenantId: number | string; scheduled?: number; banks?: number;
}) {
  return (
    <SubTabs tabs={[
      { href: at(tenantId) + '/assessments', label: 'Assessment schedule', count: scheduled },
      {
        href: at(tenantId) + '/assessments/banks',
        label: 'Assessment question bank',
        count: banks,
      },
    ]} />
  );
}
