import Link from 'next/link';
import type { Metadata } from 'next';
import { apiSafe } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Verify certificate',
  robots: 'noindex',   // a verification result is not a search result
};

interface VerifyResult {
  verified: boolean;
  certificate: {
    identifier: string; student_name: string | null;
    course_title: string | null; course_slug: string | null; issued_at: string | null;
  } | null;
}

/**
 * CERT-03 -- the page a QR scan lands on. Public and unauthenticated by design:
 * an employer checking a certificate should not need an account.
 */
export default async function VerifyCertificate(
  { params }: { params: Promise<{ identifier: string }> },
) {
  const { identifier } = await params;
  const result = await apiSafe<VerifyResult>(
    '/api/verify/certificate/' + encodeURIComponent(identifier));

  const verified = result?.verified && result.certificate;

  return (
    <div className="container-page max-w-xl py-16">
      <div className="card p-8 text-center">
        {verified ? (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-50 text-2xl text-green-700">
              ✓
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-green-800">Certificate verified</h1>
            <p className="mt-1 text-sm text-slate-500">
              This certificate was issued by us and is genuine.
            </p>

            <dl className="mt-8 space-y-3 text-left">
              <Row label="Awarded to" value={result!.certificate!.student_name ?? '-'} />
              <Row label="Course" value={result!.certificate!.course_title ?? '-'} />
              <Row label="Issued"
                value={result!.certificate!.issued_at
                  ? new Date(result!.certificate!.issued_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '-'} />
              <Row label="Certificate ID" value={result!.certificate!.identifier} mono />
            </dl>

            {result!.certificate!.course_slug && (
              <Link href={'/course/' + result!.certificate!.course_slug}
                className="btn-ghost mt-8">View the course</Link>
            )}
          </>
        ) : (
          <>
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl text-red-700">
              ✕
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-red-800">Not verified</h1>
            <p className="mt-2 text-sm text-slate-600">
              No certificate matches the id <span className="font-mono">{identifier}</span>.
              Check the code, or the certificate may have been revoked.
            </p>
            <Link href="/" className="btn-ghost mt-6">Back to the site</Link>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b border-slate-100 pb-2">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className={'text-sm font-medium ' + (mono ? 'font-mono' : '')}>{value}</dd>
    </div>
  );
}
