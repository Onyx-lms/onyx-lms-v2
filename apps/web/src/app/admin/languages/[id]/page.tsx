import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireRole, apiAuthSafe } from '@/lib/session';
import { DashboardShell } from '@/components/dashboard-shell';
import { ADMIN_NAV } from '@/lib/nav';
import { PhraseEditor, type Phrase } from '@/components/phrase-editor';

export const metadata: Metadata = { title: 'Translations' };
export const dynamic = 'force-dynamic';

interface Payload { rows: Phrase[]; total: number; page: number; per_page: number }

/** SET-06 -- translate one language, a page at a time. */
export default async function TranslateLanguage(
  { params, searchParams }: {
    params: Promise<{ id: string }>;
    searchParams: Promise<Record<string, string | undefined>>;
  },
) {
  const session = await requireRole('admin');
  const { id } = await params;
  const query = await searchParams;
  const search = query['search'] ?? '';
  const page = Math.max(1, Number(query['page'] ?? 1));

  const q = new URLSearchParams({ page: String(page), per_page: '50' });
  if (search) q.set('search', search);
  const payload = await apiAuthSafe<Payload>(
    '/api/admin/languages/' + encodeURIComponent(id) + '/phrases?' + q.toString());
  if (!payload) notFound();

  return (
    <DashboardShell role={session.app_role} email={session.email}
      nav={ADMIN_NAV} title="Translations">
      <Link href="/admin/languages" className="mb-4 inline-block text-sm text-brand-700 hover:underline">
        Back to languages
      </Link>
      <PhraseEditor languageId={Number(id)} rows={payload.rows} total={payload.total}
        page={payload.page} perPage={payload.per_page} search={search} />
    </DashboardShell>
  );
}
