import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { onyxApi, requireOnyxSession, type Me } from '@/lib/onyx-session';
import { ResumeEditor } from '@/components/onyx-resume-editor';
import { Banner, Card, Empty, Icon, SectionHead } from '@/components/onyx-ui';
import type { ResumeDoc } from '@/lib/onyx-resume';

export const metadata: Metadata = { title: 'Resume' };

/**
 * How ready this resume is to send, and the one thing to do about it.
 *
 * A resume assembled from a record is complete in the sense that nothing is
 * missing from the DATABASE, and that is not the same as being worth sending.
 * The parts a machine cannot derive -- an objective, a phone number, anything
 * done outside the institution -- are exactly the parts a reader notices are
 * absent, and the page said nothing about them.
 *
 * Weighted by what a reader actually looks for rather than by how hard each is
 * to fill in: an objective is worth more than a website because it is the first
 * paragraph on the page.
 */
function strengthOf(doc: ResumeDoc) {
  const checks = [
    { key: 'objective', weight: 30, done: Boolean(doc.objective.trim()),
      label: 'Write your objective',
      why: 'The first paragraph a reader meets, and the only part nothing can derive for you.' },
    { key: 'body', weight: 30, done: doc.sections.some((x) => x.key !== 'objective'),
      label: 'Have something on your record',
      why: 'Courses, certificates and batches appear here on their own as you earn them.' },
    { key: 'headline', weight: 15, done: Boolean(doc.headline.trim()),
      label: 'Add a headline to your profile',
      why: 'One line under your name. It is what a reader uses to place you.' },
    { key: 'extras', weight: 15, done: doc.extras.length > 0,
      label: 'Add anything from outside',
      why: 'A job, a publication, something you volunteered for — your institution does not '
        + 'know about any of it.' },
    { key: 'contact', weight: 10, done: Boolean(doc.phone.trim() || doc.website.trim()),
      label: 'Add a second way to reach you',
      why: 'An email alone is thin on a document you send to strangers.' },
  ];
  const earned = checks.filter((c) => c.done).reduce((n, c) => n + c.weight, 0);
  const missing = checks.filter((c) => !c.done);
  return { percent: earned, missing, next: missing[0] };
}

/**
 * O10 -- a learner's resume, assembled rather than typed.
 *
 * The document is the thing somebody came here for, so it is drawn as a
 * document: a white sheet on a tinted ground, with the page's own margins,
 * rather than as one more card in a stack of cards. That is how every product
 * whose subject is a document draws it, and it is not decoration -- it tells a
 * reader at a glance which half of the screen is the artefact and which half is
 * the controls.
 *
 * Nothing here is stored as a rendered document. A certificate issued tomorrow
 * is on this page tomorrow, with nobody pressing a "regenerate" button that
 * would only ever be pressed by the people who did not need to.
 */
export default async function OnyxResumePage() {
  await requireOnyxSession();

  const [me, doc] = await Promise.all([
    onyxApi<Me>('/api/onyx/me'),
    onyxApi<ResumeDoc>('/api/onyx/my/resume'),
  ]);

  const empty = !doc.sections.length;
  const strength = strengthOf(doc);
  const entries = doc.sections.reduce((n, sx) => n + sx.items.length, 0);

  return (
    <OnyxShell me={me} nav={navFor(me.role)} title="Resume"
      subtitle="Assembled from your record here. Yours to edit and to download.">

      {/*
        * Said before the download, not after it. The PDF is set in a
        * Latin-script font, so a name written in another script renders as
        * question marks -- and handing somebody a document that misspells
        * their own name without warning is worse than not offering one.
        */}
      {doc.pdf_will_mangle ? (
        <div className="mb-4">
          <Banner tone="warn" icon="alert">
            The PDF is set in a Latin-script font and cannot render your name as you have
            written it. Everything on this page is complete — the PDF is not. You can still
            download it, and the on-screen version is the accurate one.
          </Banner>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0">
          {/*
            * The sheet, on a ground.
            *
            * `p-5 sm:p-8` inside a white surface with a soft shadow reads as
            * paper; the tinted panel behind it is what makes it read as paper
            * rather than as a wide card. The measure is held near sixty-five
            * characters so the prose is readable, which is also roughly what
            * the A4 PDF gives.
            */}
          <div className="rounded-2xl bg-slate-100/70 p-3 sm:p-5 dark:bg-slate-900/40">
            <article
              aria-label="Your resume"
              className="mx-auto max-w-[46rem] rounded-xl bg-white p-5 shadow-sm
                         ring-1 ring-black/5 sm:p-8"
            >
              <header className="space-y-1">
                <h2 className="text-[24px] font-bold leading-tight tracking-tight text-slate-900">
                  {doc.name}
                </h2>
                {doc.headline ? (
                  <p className="text-[14px] text-slate-600">{doc.headline}</p>
                ) : null}
                <p className="text-[12.5px] text-slate-500">
                  {[doc.email, doc.phone, doc.website].filter(Boolean).join('  ·  ')}
                </p>
              </header>

              <div className="mt-5 border-t border-slate-200 pt-5">
                {empty ? (
                  <Empty icon="file">
                    There is nothing on your record here yet. As you are added to a batch,
                    enrol on courses and are issued certificates, they appear here on their
                    own — you do not have to type any of it.
                  </Empty>
                ) : (
                  <div className="space-y-6">
                    {doc.sections.map((section) => (
                      <section key={section.key}>
                        {/* A rule under the heading, which is the convention a
                            resume is read with -- and the same shape the PDF
                            builder draws, so the screen is not promising a
                            layout the download does not deliver. */}
                        <h3 className="border-b border-slate-200 pb-1 text-[11px] font-bold
                                       uppercase tracking-[.08em] text-slate-500">
                          {section.label}
                        </h3>
                        <div className="mt-2.5 space-y-3">
                          {section.items.map((item) => (
                            <div key={item.key} className="text-[13.5px] leading-relaxed">
                              {item.title ? (
                                <div className="flex items-baseline justify-between gap-3">
                                  <span className="font-semibold text-slate-900">
                                    {item.title}
                                  </span>
                                  {item.when ? (
                                    <span className="shrink-0 tabular-nums text-[12px]
                                                     text-slate-500">
                                      {item.when}
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                              {[item.subtitle, item.detail].filter(Boolean).length ? (
                                <p className="text-[12.5px] leading-relaxed text-slate-600">
                                  {[item.subtitle, item.detail].filter(Boolean).join('  ·  ')}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            </article>
          </div>

          {/* Underneath the sheet, where a page footer goes: what this
              document currently amounts to, in plain numbers. */}
          <p className="mt-2.5 px-1 text-[12px] text-muted">
            {doc.sections.length}
            {doc.sections.length === 1 ? ' section' : ' sections'} ·{' '}
            {entries} {entries === 1 ? 'entry' : 'entries'} · assembled just now, from your
            record at {doc.institution}
          </p>
        </div>

        {/*
          * The controls, sticky.
          *
          * The rail is taller than the viewport on any real record, and the
          * download is the thing most people came for -- so it stays in view
          * rather than being something you scroll back up to find.
          */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <Card className="p-4">
            <div className="flex items-baseline justify-between gap-3">
              <SectionHead title="Ready to send" />
              <span className="text-[13px] font-bold tabular-nums text-ink">
                {strength.percent}%
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={strength.percent} aria-valuemin={0} aria-valuemax={100}
              aria-label={'Resume ' + strength.percent + ' per cent ready'}
              className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
            >
              <span
                className={'block h-full rounded-full '
                  + (strength.percent >= 85 ? 'bg-green-600' : 'bg-brand-600')}
                style={{ width: Math.max(2, strength.percent) + '%' }}
              />
            </div>

            {strength.next ? (
              <div className="mt-3">
                <p className="text-[12px] font-bold uppercase tracking-wide text-muted">
                  Do this next
                </p>
                <p className="mt-1 text-[13px] font-semibold leading-snug text-ink">
                  {strength.next.label}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">
                  {strength.next.why}
                </p>
                {strength.missing.length > 1 ? (
                  <p className="mt-1.5 text-[12px] text-muted">
                    {strength.missing.length - 1} other{' '}
                    {strength.missing.length - 1 === 1 ? 'thing' : 'things'} would help too.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-[12.5px] leading-relaxed text-green-800">
                Nothing obvious is missing. Download it and send it.
              </p>
            )}

            <a
              href="/api/proxy/onyx/my/resume/document.pdf"
              download
              className="mt-3.5 inline-flex min-h-[42px] w-full items-center justify-center
                         gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white
                         hover:bg-brand-700"
            >
              <Icon name="download" className="h-4 w-4" />
              Download the PDF
            </a>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              A4, one column, the conventional shape — built from what is on this page at the
              moment you press it. There is no stale copy to regenerate.
            </p>
          </Card>

          <ResumeEditor doc={doc} />
        </div>
      </div>
    </OnyxShell>
  );
}
