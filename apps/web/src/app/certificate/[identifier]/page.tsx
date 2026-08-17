import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { apiSafe } from '@/lib/api';

export const metadata: Metadata = { title: 'Certificate', robots: 'noindex' };

interface RenderResult {
  verified: boolean;
  certificate: {
    identifier: string; student_name: string | null;
    course_title: string | null; issued_at: string | null;
  } | null;
  template: {
    background: string | null; signature: string | null;
    name_top: number; name_left: number;
    course_top: number; course_left: number;
    date_top: number; date_left: number;
    qr_top: number; qr_left: number; qr_size: number;
  };
  qr: string;
  verify_url: string;
}

/**
 * CERT-04 -- the printable certificate.
 *
 * Everything is inline (the QR is a data URI), so printing or saving to PDF
 * produces the same document with no external requests.
 */
export default async function CertificatePage(
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params;
  const result = await apiSafe<RenderResult>(
    '/api/certificates/' + encodeURIComponent(identifier) + '/render');
  if (!result?.verified || !result.certificate) notFound();

  const { certificate: cert, template: t } = result;
  const at = (top: number, left: number) => ({
    position: 'absolute' as const, top: top + '%', left: left + '%',
    transform: 'translate(-50%, -50%)',
  });

  return (
    <div className="container-page max-w-4xl py-10">
      <div
        className="relative mx-auto aspect-[1.414/1] w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none"
        style={t.background ? {
          backgroundImage: 'url(' + t.background + ')',
          backgroundSize: 'cover', backgroundPosition: 'center',
        } : undefined}
      >
        {!t.background && (
          <div className="absolute inset-4 rounded-lg border-4 border-double border-brand-200" />
        )}

        <div className="absolute inset-x-0 top-[14%] text-center">
          <div className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Certificate of completion
          </div>
        </div>

        <div style={at(t.name_top, t.name_left)} className="w-full text-center">
          <div className="text-3xl font-semibold text-slate-900">{cert.student_name}</div>
          <div className="mt-1 text-xs text-slate-500">has successfully completed</div>
        </div>

        <div style={at(t.course_top, t.course_left)} className="w-4/5 text-center">
          <div className="text-xl font-medium text-brand-800">{cert.course_title}</div>
        </div>

        <div style={at(t.date_top, t.date_left)} className="text-center">
          <div className="text-sm text-slate-700">
            {cert.issued_at ? new Date(cert.issued_at).toLocaleDateString() : ''}
          </div>
          <div className="mt-1 border-t border-slate-300 pt-1 text-[10px] uppercase tracking-wider text-slate-500">
            Date
          </div>
        </div>

        <div style={{ position: 'absolute', top: t.qr_top + '%', left: t.qr_left + '%',
                      width: t.qr_size + '%' }}>
          <img src={result.qr} alt="Scan to verify" className="w-full" />
          <div className="mt-1 text-center font-mono text-[8px] text-slate-500">
            {cert.identifier}
          </div>
        </div>
      </div>

      <div className="mt-6 flex justify-center gap-3 print:hidden">
        <Link href={result.verify_url} className="btn-ghost">Verification page</Link>
        <Link href="/my-courses" className="btn-ghost">My courses</Link>
      </div>
      <p className="mt-3 text-center text-xs text-slate-500 print:hidden">
        Use your browser&apos;s print dialog to save this as a PDF.
      </p>
    </div>
  );
}
