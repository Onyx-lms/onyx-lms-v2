import type { Metadata } from 'next';
import { OnyxShell } from '@/components/onyx-shell';
import { navFor } from '@/lib/onyx-nav';
import { onyxApi, requireOnyxSession, type Me } from '@/lib/onyx-session';
import { ResumeEditor } from '@/components/onyx-resume-editor';
import { Banner, Card, Empty, Icon, SectionHead } from '@/components/onyx-ui';
import type { ResumeDoc } from '@/lib/onyx-resume';

export const metadata: Metadata = { title: 'Resume' };

/**
 * O10 -- a learner's resume, assembled rather than typed.
 *
 * The page shows the document itself first and the controls second, because
 * the thing somebody came here for is the resume. The editor below it is a
 * list of decisions -- what to leave out, what to add, how to order it -- and
 * each one re-renders this page from the server rather than mutating a copy
 * held in the browser, so what is on screen is always what the PDF will say.
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

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="min-w-0 space-y-6">
          <Card>
            {/* The document, laid out the way it prints: name, then the line
                under it, then sections. Not a preview of the PDF -- the same
                content, set for a screen. */}
            <div className="space-y-1">
              <h2 className="text-[22px] font-bold leading-tight text-ink">{doc.name}</h2>
              {doc.headline ? (
                <p className="text-[14px] text-muted">{doc.headline}</p>
              ) : null}
              <p className="text-[12.5px] text-muted">
                {[doc.email, doc.phone, doc.website].filter(Boolean).join('  ·  ')}
              </p>
            </div>

            <div className="mt-4 border-t border-line pt-4">
              {empty ? (
                <Empty icon="file">
                  There is nothing on your record here yet. As you are added to a batch,
                  enrol on courses and are issued certificates, they appear here on their
                  own — you do not have to type any of it.
                </Empty>
              ) : (
                <div className="space-y-5">
                  {doc.sections.map((section) => (
                    <section key={section.key}>
                      <h3 className="text-[11px] font-bold uppercase tracking-wide text-muted">
                        {section.label}
                      </h3>
                      <div className="mt-2 space-y-2.5">
                        {section.items.map((item) => (
                          <div key={item.key} className="text-[13.5px] leading-relaxed">
                            {item.title ? (
                              <div className="flex items-baseline justify-between gap-3">
                                <span className="font-semibold text-ink">{item.title}</span>
                                {item.when ? (
                                  <span className="shrink-0 tabular-nums text-[12px] text-muted">
                                    {item.when}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                            {[item.subtitle, item.detail].filter(Boolean).length ? (
                              <p className="text-[12.5px] text-muted">
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
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionHead title="Download" />
            <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
              A4, one column, the conventional shape. It is built from what is on this page
              at the moment you press it — there is no stale copy to regenerate.
            </p>
            <a
              href="/api/proxy/onyx/my/resume/document.pdf"
              download
              className="mt-3 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl
                         bg-brand-600 px-4 text-sm font-bold text-white hover:bg-brand-700"
            >
              <Icon name="download" className="h-4 w-4" />
              Download the PDF
            </a>
          </Card>

          <ResumeEditor doc={doc} />
        </div>
      </div>
    </OnyxShell>
  );
}
