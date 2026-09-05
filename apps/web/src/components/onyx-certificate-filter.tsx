'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';

/**
 * Narrowing a credential register to one certificate design.
 *
 * "How many internship certificates have we issued" is the question a
 * registrar actually asks, and it is not the same as "how many of kind
 * `internship`": several kinds print on one design -- a contest placing and
 * an assessment result are both Performance certificates -- so filtering by
 * the stored `kind` would answer a question nobody asked and quietly leave
 * rows out.
 *
 * The filter lives in the query string rather than in component state, so a
 * filtered register is a URL somebody can send to the person who asked.
 *
 * Same shape as SectionFilter next door, deliberately: these two sit on
 * sibling console screens and a select that behaves differently on each is a
 * worse answer than a little repetition.
 */
export function TemplateFilter({ templates, current, counts }: {
  templates: string[];
  current?: string;
  /** How many credentials each design has, so the picker says what it will do. */
  counts?: Record<string, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  if (!templates.length) return null;

  return (
    <label className="flex items-center gap-2">
      <span className="text-[12.5px] font-semibold text-slate-700">Template</span>
      <select
        value={current ?? ''}
        aria-label="Filter by certificate template"
        className="min-h-[36px] rounded-xl border border-line bg-white px-2.5 text-[13px]"
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set('template', e.target.value);
          else next.delete('template');
          router.push(pathname + (next.toString() ? '?' + next.toString() : ''));
        }}
      >
        <option value="">Every template</option>
        {templates.map((t) => (
          <option key={t} value={t}>
            {t}{counts ? ' (' + (counts[t] ?? 0) + ')' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
